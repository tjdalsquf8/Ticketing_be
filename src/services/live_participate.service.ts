import crypto from "crypto";
import pool from "../config/db";
import config from "../config";
import type { PoolClient } from "pg";
import { emitSeatUpdate } from "../events/seatEvents";
import { emitQueueChanged } from "../events/queueEvents";
import * as liveQueue from "./live_queue.redis";
import * as liveSession from "./live_session.redis";
import * as liveActive from "./live_active.redis";
import * as liveSeatLock from "./live_seat_lock.redis";

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface CreateSessionParams {
  roundId: number;
  userId?: number | null;
  guestUuid?: string | null;
  nickname: string;
}

export interface CreateSessionResult {
  sessionId: string;
  status: "active" | "queued" | "completed";
  queuePosition: number | null;
  startedAt: string;
}

export interface QueueStatusResult {
  sessionId: string;
  status: string;
  queuePosition: number | null;
  ready: boolean;
  contextType: "round" | "event";
  contextId: number;
}

export interface SeatRow {
  seatLabel: string;
  status: "available" | "held" | "sold";
}

export interface GetSeatsResult {
  seats: SeatRow[];
  myHold: { seatLabel: string; expiresAt: string } | null;
  contextType: "round" | "event";
  contextId: number;
}

export interface HoldSeatResult {
  seatLabel: string;
  expiresAt: string;
}

export interface ConfirmSeatResult {
  rankNumber: number;
  elapsedMs: number;
}

/** 서비스 에러 구조: 컨트롤러에서 status / code / message 를 HTTP 응답으로 매핑 */
interface ServiceError extends Error {
  code: string;
  status: number;
}

// ─── 내부 헬퍼 ───────────────────────────────────────────────────────────────

/**
 * 에러 객체를 생성한다. 컨트롤러에서 instanceof 체크 없이 code/status 를 바로 읽을 수 있도록
 * Error 를 확장한다.
 */
function makeError(code: string, status: number, message: string): ServiceError {
  const err = new Error(message) as ServiceError;
  err.code = code;
  err.status = status;
  return err;
}

/**
 * 세션 소유자를 검증한다.
 * userId 또는 guestUuid 중 하나가 세션 값과 일치해야 한다.
 * 불일치 시 403 에러를 throw 한다.
 */
function assertSessionOwner(
  session: { user_id: number | null; guest_uuid: string | null },
  caller: { userId?: number | null; guestUuid?: string | null },
): void {
  const byUser = caller.userId != null && session.user_id === caller.userId;
  const byGuest =
    caller.guestUuid != null && session.guest_uuid === caller.guestUuid;
  if (!byUser && !byGuest) {
    throw makeError("FORBIDDEN", 403, "세션 접근 권한이 없습니다");
  }
}

/**
 * actor_key 를 생성한다.
 * 회원이면 "user:{userId}", 게스트면 "guest:{guestUuid}" 형식.
 */
function buildActorKey(
  userId?: number | null,
  guestUuid?: string | null,
): string {
  if (userId != null) return `user:${userId}`;
  if (guestUuid != null) return `guest:${guestUuid}`;
  throw makeError("BAD_REQUEST", 400, "userId 또는 guestUuid 가 필요합니다");
}

/**
 * active 세션을 조회·검증한다 (getSeats/holdSeat/confirmSeat 공통).
 * 라이브(round) 세션은 Redis부터 확인하고, 없으면 이벤트 세션으로 보고 Postgres로 폴백한다.
 * 소유자 불일치/active 아님은 각각 FORBIDDEN/NOT_ACTIVE 에러를 던진다.
 */
async function resolveActiveSession(
  sessionId: string,
  userId: number | null | undefined,
  guestUuid: string | null | undefined,
): Promise<{ contextType: "round" | "event"; contextId: number }> {
  const redisRecord = await liveSession.getSessionRecord(sessionId);
  if (redisRecord != null) {
    assertSessionOwner(
      { user_id: redisRecord.userId, guest_uuid: redisRecord.guestUuid },
      { userId, guestUuid },
    );
    if (redisRecord.status !== "active") {
      throw makeError("NOT_ACTIVE", 403, "active 상태의 세션만 이용할 수 있습니다");
    }
    await liveSession.touchHeartbeat(sessionId);
    return { contextType: "round", contextId: redisRecord.roundId };
  }

  // Redis에 없음 — 이벤트 세션(이관 범위 밖)만 여기로 온다.
  const sessionRes = await pool.query(
    `UPDATE live_sessions
     SET last_seen_at = NOW()
     WHERE session_id = $1
     RETURNING id, session_id, round_id, event_id, status, user_id, guest_uuid`,
    [sessionId],
  );
  if (sessionRes.rows.length === 0) {
    throw makeError("SESSION_NOT_FOUND", 404, "세션을 찾을 수 없습니다");
  }
  const session = sessionRes.rows[0];
  assertSessionOwner(session, { userId, guestUuid });
  if (session.status !== "active") {
    throw makeError("NOT_ACTIVE", 403, "active 상태의 세션만 이용할 수 있습니다");
  }
  const isEventSession = session.round_id == null && session.event_id != null;
  return {
    contextType: isEventSession ? "event" : "round",
    contextId: isEventSession ? session.event_id : session.round_id,
  };
}

// ─── 서비스 함수 ─────────────────────────────────────────────────────────────

/**
 * 1. 티켓팅 세션 생성
 *
 * 사용자가 "참여하기" 버튼을 누를 때 호출된다.
 * - 회차(round)가 open 상태인지 확인한다 (유일하게 남아있는 Postgres 읽기 — 회차
 *   상태는 자주 안 바뀌는 메타데이터라 핫패스 부담이 아니다).
 * - 이미 참여 중인 세션이 있으면 그 세션을 그대로 반환한다 (중복 참여 방지).
 *   진행 중(queued/active)인 세션은 Redis에, 이미 끝난(completed) 세션은
 *   Postgres에 있으므로 두 곳을 순서대로 확인한다.
 * - 없으면 Redis Lua로 "활성 정원 확인 + 등록"을 원자적으로 시도한다:
 *   · 여유 있으면 즉시 active.
 *   · 정원 초과면 ZSET 대기열에 등록(queued).
 * - 이 단계에서 Postgres에는 전혀 쓰지 않는다 — "DB엔 최종 결과만" 원칙.
 */
async function createSession(
  params: CreateSessionParams,
): Promise<CreateSessionResult> {
  const { roundId, userId, guestUuid, nickname } = params;

  // 회차 상태 확인 (round 메타데이터는 계속 Postgres)
  const roundRes = await pool.query(
    `SELECT status FROM live_rounds WHERE id = $1`,
    [roundId],
  );
  if (roundRes.rows.length === 0) {
    throw makeError("ROUND_NOT_FOUND", 404, "회차를 찾을 수 없습니다");
  }
  if (roundRes.rows[0].status !== "open") {
    throw makeError("ROUND_NOT_OPEN", 400, "현재 참여 가능한 회차가 아닙니다");
  }

  // 1) 진행 중(queued/active) 세션 — Redis dedup 포인터로 확인
  const existingSessionId = await liveSession.findExistingSessionId(
    roundId,
    userId ?? null,
    guestUuid ?? null,
  );
  if (existingSessionId != null) {
    const existing = await liveSession.getSessionRecord(existingSessionId);
    if (existing != null) {
      return {
        sessionId: existing.sessionId,
        status: existing.status,
        queuePosition:
          existing.status === "queued"
            ? await liveQueue.rank("round", roundId, existing.sessionId)
            : null,
        startedAt: existing.startedAt,
      };
    }
  }

  // 2) 이미 끝난(completed) 세션 — 최종 결과만 남는 Postgres에서 확인
  const completedRes = await pool.query(
    userId != null
      ? `SELECT session_id, started_at FROM live_sessions
         WHERE round_id = $1 AND user_id = $2 AND status = 'completed'`
      : `SELECT session_id, started_at FROM live_sessions
         WHERE round_id = $1 AND guest_uuid = $2 AND status = 'completed'`,
    [roundId, userId ?? guestUuid],
  );
  if (completedRes.rows.length > 0) {
    const row = completedRes.rows[0];
    return {
      sessionId: row.session_id,
      status: "completed",
      queuePosition: null,
      startedAt: row.started_at,
    };
  }

  // 게스트끼리 닉네임이 겹쳐도 참여를 막지 않는다.
  // 신원은 guest_uuid 로 구분되고(리더보드 dedup 키도 guest_uuid), 본인 기록·등수는
  // 자기 세션 기준으로 따로 조회되므로 동명이인이 있어도 서로 섞이지 않는다.

  // session_id 생성 (12자 hex)
  const sessionId = crypto.randomBytes(10).toString("hex");
  const activeCapacity = config.live.activeCapacity;

  // Lua로 "정원 확인 + 등록"을 원자적으로 시도
  const entered = await liveActive.tryEnterActive(roundId, sessionId, activeCapacity);

  if (entered) {
    const record = await liveSession.createSessionRecord({
      sessionId,
      roundId,
      userId: userId ?? null,
      guestUuid: guestUuid ?? null,
      nickname,
      status: "active",
    });
    return {
      sessionId: record.sessionId,
      status: "active",
      queuePosition: null,
      startedAt: record.startedAt,
    };
  }

  // 정원 초과 → 대기열(ZSET) 등록
  const record = await liveSession.createSessionRecord({
    sessionId,
    roundId,
    userId: userId ?? null,
    guestUuid: guestUuid ?? null,
    nickname,
    status: "queued",
  });
  await liveQueue.enqueue("round", roundId, sessionId);
  // enqueue가 리턴하는 seq는 "누적 발급 번호"라 중간 이탈자가 있으면 실제
  // 순번과 어긋난다. rank()로 다시 조회해 정확한 현재 순번을 돌려준다.
  const position = await liveQueue.rank("round", roundId, sessionId);

  return {
    sessionId: record.sessionId,
    status: "queued",
    queuePosition: position,
    startedAt: record.startedAt,
  };
}

/**
 * 2. 대기열 상태 조회
 *
 * 사용자가 대기 중일 때 폴링으로 호출한다.
 * - 세션이 존재하지 않으면 404.
 * - 세션 소유자가 아니면 403.
 * - 현재 status, 대기 순번, ready 여부(status==='active')를 반환한다.
 */
async function getQueueStatus(params: {
  sessionId: string;
  userId?: number | null;
  guestUuid?: string | null;
}): Promise<QueueStatusResult> {
  const { sessionId, userId, guestUuid } = params;

  // 1) 라이브(round) 세션은 queued/active 동안 Postgres에 아예 없다 — Redis부터 확인.
  const redisRecord = await liveSession.getSessionRecord(sessionId);
  if (redisRecord != null) {
    assertSessionOwner(
      { user_id: redisRecord.userId, guest_uuid: redisRecord.guestUuid },
      { userId, guestUuid },
    );

    // heartbeat: 조회 자체가 "살아있음" 신호 → lastSeenAt 갱신
    await liveSession.touchHeartbeat(sessionId);

    const livePosition =
      redisRecord.status === "queued"
        ? await liveQueue.rank("round", redisRecord.roundId, sessionId)
        : null;

    return {
      sessionId,
      status: redisRecord.status,
      queuePosition: livePosition,
      ready: redisRecord.status === "active",
      contextType: "round",
      contextId: redisRecord.roundId,
    };
  }

  // 2) Redis에 없음 — 이벤트 세션(아직 이관 범위 밖, 계속 Postgres) 또는 이미
  //    completed/failed 처리된 라이브 세션. 기존 Postgres 경로로 폴백한다.
  const res = await pool.query(
    `UPDATE live_sessions
     SET last_seen_at = NOW()
     WHERE session_id = $1
     RETURNING session_id, round_id, event_id, status, queue_position, user_id, guest_uuid`,
    [sessionId],
  );

  if (res.rows.length === 0) {
    throw makeError("SESSION_NOT_FOUND", 404, "세션을 찾을 수 없습니다");
  }

  const session = res.rows[0];
  assertSessionOwner(session, { userId, guestUuid });

  const isEventSession = session.round_id == null && session.event_id != null;
  const contextCol = isEventSession ? "event_id" : "round_id";
  const contextId: number = isEventSession ? session.event_id : session.round_id;

  // 이 경로로 온 라이브(round) 세션은 completed/failed뿐이라(queued/active는 위에서
  // 이미 처리됨) queue_position이 없을 것이고, 이벤트 세션만 여전히 Postgres COUNT로 계산.
  let livePosition: number | null = null;
  if (isEventSession && session.status === "queued" && session.queue_position != null) {
    const posRes = await pool.query(
      `SELECT COUNT(*)::int + 1 AS live_position
       FROM live_sessions
       WHERE ${contextCol} = $1
         AND status = 'queued'
         AND queue_position < $2`,
      [contextId, session.queue_position],
    );
    livePosition = posRes.rows[0].live_position as number;
  }

  return {
    sessionId: session.session_id,
    status: session.status,
    queuePosition: livePosition,
    ready: session.status === "active",
    contextType: isEventSession ? "event" : "round",
    contextId,
  };
}

/**
 * 3. 좌석 목록 조회
 *
 * active 상태인 사용자가 좌석 선택 화면을 열 때 호출한다.
 * - 세션이 active 상태가 아니면 403(NOT_ACTIVE).
 * - 해당 회차의 전체 좌석 목록과 각 좌석 상태(available/held/sold)를 반환한다.
 * - 본인이 hold 중인 좌석이 있으면 myHold 에 담아 반환한다.
 */
async function getSeats(params: {
  sessionId: string;
  userId?: number | null;
  guestUuid?: string | null;
}): Promise<GetSeatsResult> {
  const { sessionId, userId, guestUuid } = params;

  const { contextType, contextId } = await resolveActiveSession(sessionId, userId, guestUuid);
  const isEventSession = contextType === "event";
  const contextCol = isEventSession ? "event_id" : "round_id";
  const actorKey = buildActorKey(userId, guestUuid);

  // 좌석 카탈로그 + sold 여부는 계속 Postgres가 원장 (sold는 confirm 시 거기 쓴다).
  const seatsRes = await pool.query(
    `SELECT seat_label, status FROM live_seats WHERE ${contextCol} = $1 ORDER BY seat_label ASC`,
    [contextId],
  );

  let myHold: { seatLabel: string; expiresAt: string } | null;
  let heldLabels: Set<string>;

  if (isEventSession) {
    // 이벤트 세션은 이관 범위 밖 — hold도 계속 Postgres live_holds.
    const holdRes = await pool.query(
      `SELECT ls.seat_label, lh.expires_at
       FROM live_holds lh
       JOIN live_seats ls ON ls.id = lh.seat_id
       WHERE lh.${contextCol} = $1 AND lh.actor_key = $2`,
      [contextId, actorKey],
    );
    myHold = holdRes.rows.length > 0
      ? { seatLabel: holdRes.rows[0].seat_label, expiresAt: holdRes.rows[0].expires_at }
      : null;
    heldLabels = new Set(); // 이벤트는 live_seats.status 컬럼이 그대로 held를 담고 있어 별도 조회 불필요
  } else {
    // 라이브(round) 세션 — hold는 Redis 기준
    myHold = await liveSeatLock.getMyHold(contextId, actorKey);
    heldLabels = await liveSeatLock.scanHeldLabels(contextId);
  }

  return {
    seats: seatsRes.rows.map((r) => ({
      seatLabel: r.seat_label,
      // 라이브: Redis가 "지금 누가 잡고 있는지"의 유일한 소스. sold는 Postgres가 원장.
      status: isEventSession
        ? r.status
        : r.status === "sold"
          ? "sold"
          : heldLabels.has(r.seat_label)
            ? "held"
            : "available",
    })),
    myHold,
    contextType: isEventSession ? "event" : "round",
    contextId,
  };
}

/**
 * 4. 좌석 임시 점유(hold)
 *
 * 사용자가 좌석을 선택할 때 호출한다. 30초 동안 해당 좌석을 예약 대기 상태로 잠근다.
 * - 세션 소유자·active 상태·회차 open 상태를 모두 검증한다.
 * - 이미 본인이 hold 한 좌석이 있으면 그 hold 를 먼저 해제하고 새 좌석을 잡는다.
 * - 대상 좌석 상태별 에러 분기:
 *     held → SEAT_ALREADY_HELD (다른 세션이 임시 점유 중)
 *     sold → SEAT_ALREADY_CONFIRMED (이미 확정·판매됨)
 *     그 외 비정상 상태 → SEAT_UNAVAILABLE (fallback)
 * - 성공 시 좌석 label 과 만료 시각(expiresAt)을 반환한다.
 */
async function holdSeat(params: {
  sessionId: string;
  seatLabel: string;
  userId?: number | null;
  guestUuid?: string | null;
}): Promise<HoldSeatResult> {
  const { sessionId, seatLabel, userId, guestUuid } = params;

  const { contextType, contextId } = await resolveActiveSession(sessionId, userId, guestUuid);
  const isEventSession = contextType === "event";
  const contextCol = isEventSession ? "event_id" : "round_id";

  // 라이브 세션만 회차 open 검증 (이벤트 세션은 event.status = 'open' 이 보장됨)
  if (!isEventSession) {
    const roundRes = await pool.query(
      `SELECT status FROM live_rounds WHERE id = $1`,
      [contextId],
    );
    if (roundRes.rows[0].status !== "open") {
      throw makeError("ROUND_NOT_OPEN", 400, "회차가 종료되어 좌석을 점유할 수 없습니다");
    }
  }

  const actorKey = buildActorKey(userId, guestUuid);

  if (!isEventSession) {
    // 라이브(round) 세션 — hold 동시성은 Redis Lua가 맡는다.
    // sold는 영구 기록이라 Postgres가 원장 — hold 시도 전에 먼저 확인한다.
    const seatRes = await pool.query(
      `SELECT status FROM live_seats WHERE round_id = $1 AND seat_label = $2`,
      [contextId, seatLabel],
    );
    if (seatRes.rows.length === 0) {
      throw makeError("SEAT_NOT_FOUND", 404, "좌석을 찾을 수 없습니다");
    }
    if (seatRes.rows[0].status === "sold") {
      throw makeError("SEAT_ALREADY_CONFIRMED", 409, "이미 판매된 좌석입니다.");
    }

    const ttlMs = config.live.holdTtlSeconds * 1000;
    const result = await liveSeatLock.tryHold(contextId, seatLabel, actorKey, ttlMs);
    if (result === "HELD") {
      throw makeError("SEAT_ALREADY_HELD", 409, "다른 사용자가 이 좌석을 잠시 잡고 있습니다.");
    }

    const expiresAt = new Date(Date.now() + ttlMs);
    emitSeatUpdate({ seatLabel, status: "held", contextType: "round", contextId });
    return { seatLabel, expiresAt: expiresAt.toISOString() };
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── 락 순서 정렬 (데드락 방지) ───────────────────────────────────────────
    // PostgreSQL 은 FOR UPDATE 를 LEFT JOIN 의 nullable 쪽에 적용할 수 없다.
    // 따라서 2단계로 처리한다:
    //   1) 기존 본인 hold seat_id 를 FOR UPDATE 없이 조회
    //   2) 대상 좌석 seat_id + 기존 hold seat_id 를 id ASC 순서로 FOR UPDATE 획득
    // 모든 트랜잭션이 항상 낮은 seat_id 부터 락을 획득하므로 순환 대기가 발생하지 않는다.

    // 1) 대상 좌석: 이벤트 세션은 live_seats 레코드가 없으면 upsert (FE가 좌석 카탈로그 소유)
    if (isEventSession) {
      await client.query(
        `INSERT INTO live_seats (event_id, seat_label)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [contextId, seatLabel],
      );
    }

    // 2) 기존 본인 hold + 대상 좌석 id를 한 번에 조회 (락 없음, 왕복 2회 → 1회로 축소)
    const lookupRes = await client.query(
      `SELECT
         (SELECT lh.id FROM live_holds lh
            WHERE lh.${contextCol} = $1 AND lh.actor_key = $2) AS hold_id,
         (SELECT lh.seat_id FROM live_holds lh
            WHERE lh.${contextCol} = $1 AND lh.actor_key = $2) AS prev_seat_id,
         (SELECT ls.id FROM live_seats ls
            WHERE ls.${contextCol} = $1 AND ls.seat_label = $3) AS target_seat_id`,
      [contextId, actorKey, seatLabel],
    );
    const { hold_id, prev_seat_id, target_seat_id } = lookupRes.rows[0];
    if (target_seat_id == null) {
      await client.query("ROLLBACK");
      throw makeError("SEAT_NOT_FOUND", 404, "좌석을 찾을 수 없습니다");
    }
    const prevHold = hold_id != null ? { hold_id, prev_seat_id } : null;
    const targetSeatId: number = target_seat_id;

    // 3) 잠글 seat_id 목록을 id ASC 로 정렬 후 한 번에 FOR UPDATE
    const seatIdsToLock: number[] = Array.from(
      new Set(
        prevHold && prevHold.prev_seat_id !== targetSeatId
          ? [prevHold.prev_seat_id, targetSeatId]
          : [targetSeatId],
      ),
    ).sort((a, b) => a - b);

    const lockedRes = await client.query(
      `SELECT id, seat_label, status FROM live_seats
       WHERE id = ANY($1)
       ORDER BY id ASC
       FOR UPDATE`,
      [seatIdsToLock],
    );

    const targetSeat = lockedRes.rows.find((r) => r.id === targetSeatId)!;

    // 기존 hold 해제 (다른 좌석이었을 때만)
    if (prevHold && prevHold.prev_seat_id !== targetSeatId) {
      await client.query(`DELETE FROM live_holds WHERE id = $1`, [prevHold.hold_id]);
      await client.query(
        `UPDATE live_seats SET status = 'available' WHERE id = $1 AND status = 'held'`,
        [prevHold.prev_seat_id],
      );
    }

    // 대상 좌석 상태 확인
    // 같은 좌석을 다시 요청(본인 재hold)하면 held 상태도 허용 → TTL 갱신
    const isSelfReHold = prevHold != null && prevHold.prev_seat_id === targetSeatId;
    if (targetSeat.status !== "available" && !isSelfReHold) {
      await client.query("ROLLBACK");
      if (targetSeat.status === "held") {
        throw makeError("SEAT_ALREADY_HELD", 409, "다른 사용자가 이 좌석을 잠시 잡고 있습니다.");
      }
      if (targetSeat.status === "sold") {
        throw makeError("SEAT_ALREADY_CONFIRMED", 409, "이미 판매된 좌석입니다.");
      }
      throw makeError("SEAT_UNAVAILABLE", 409, "이미 선택된 좌석입니다");
    }

    // hold INSERT (TTL = config.live.holdTtlSeconds 초)
    // 라이브: (round_id, actor_key) unique / 이벤트: (event_id, actor_key) unique partial index
    const expiresAt = new Date(Date.now() + config.live.holdTtlSeconds * 1000);
    if (isEventSession) {
      await client.query(
        `INSERT INTO live_holds (event_id, seat_id, actor_key, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (event_id, actor_key) WHERE event_id IS NOT NULL DO UPDATE
           SET seat_id = EXCLUDED.seat_id,
               expires_at = EXCLUDED.expires_at,
               created_at = NOW()`,
        [contextId, targetSeatId, actorKey, expiresAt.toISOString()],
      );
    } else {
      await client.query(
        `INSERT INTO live_holds (round_id, seat_id, actor_key, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (round_id, actor_key) DO UPDATE
           SET seat_id = EXCLUDED.seat_id,
               expires_at = EXCLUDED.expires_at,
               created_at = NOW()`,
        [contextId, targetSeatId, actorKey, expiresAt.toISOString()],
      );
    }

    // 좌석 상태 → held
    await client.query(
      `UPDATE live_seats SET status = 'held' WHERE id = $1`,
      [targetSeatId],
    );

    await client.query("COMMIT");

    emitSeatUpdate({
      seatLabel,
      status: "held",
      contextType: isEventSession ? "event" : "round",
      contextId,
    });

    return { seatLabel, expiresAt: expiresAt.toISOString() };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 5. 좌석 구매 확정
 *
 * 사용자가 "결제/확정" 버튼을 누를 때 호출한다.
 * - hold 가 만료되지 않았는지 확인한다.
 * - 좌석 상태를 sold 로 변경하고 hold 를 삭제한다.
 * - 세션을 completed 로 처리하고 경과 시간을 기록한다
 *   (started_at = 대기실 입장 시각 ~ confirm 처리 시각, 대기열 대기 시간 포함).
 * - 해당 회차 내 완료 순위(elapsed_ms ASC)를 계산한다.
 * - 이벤트 세션이면 event_registrations 를 ticketed 로 전이한다.
 * - 반환값: 순위, 경과 시간.
 *
 * 주의: rankNumber 는 "확정 시점까지 완주한 사람" 기준이라 최종 순위와 다를 수 있다.
 * 확정된 최종 순위는 live_sessions.elapsed_ms 를 정렬하는 랭킹 API 를 봐야 한다.
 */
async function confirmSeat(params: {
  sessionId: string;
  seatLabel: string;
  userId?: number | null;
  guestUuid?: string | null;
}): Promise<ConfirmSeatResult> {
  const { sessionId, seatLabel, userId, guestUuid } = params;

  // 라이브(round) 세션은 Redis부터 확인한다. "DB엔 최종 결과만" 원칙의
  // 핵심 지점 — confirm 성공 시에만 Postgres에 INSERT한다.
  const redisRecord = await liveSession.getSessionRecord(sessionId);
  if (redisRecord != null) {
    return confirmLiveSeat({ sessionId, seatLabel, userId, guestUuid, record: redisRecord });
  }

  // Redis에 없음 — 이벤트 세션(이관 범위 밖), 기존 Postgres 로직 그대로.
  const sessionRes = await pool.query(
    `SELECT id, session_id, round_id, event_id, status, user_id, guest_uuid, nickname, started_at
     FROM live_sessions
     WHERE session_id = $1`,
    [sessionId],
  );
  if (sessionRes.rows.length === 0) {
    throw makeError("SESSION_NOT_FOUND", 404, "세션을 찾을 수 없습니다");
  }
  const session = sessionRes.rows[0];
  assertSessionOwner(session, { userId, guestUuid });

  if (session.status !== "active") {
    throw makeError("NOT_ACTIVE", 403, "active 상태의 세션만 구매를 확정할 수 있습니다");
  }

  // round_id(라이브) 또는 event_id(이벤트) 기반으로 분기
  const isEventSession = session.round_id == null && session.event_id != null;
  const contextCol = isEventSession ? "event_id" : "round_id";
  const contextId: number = isEventSession ? session.event_id : session.round_id;
  const sessionDbId: number = session.id;

  // event_registrations 갱신 대상 event_id 결정.
  // 라이브 세션이면 갱신할 신청 레코드가 없으므로 null.
  let ticketEventId: number | null;
  if (isEventSession) {
    ticketEventId = contextId;
  } else {
    // 라이브 세션: 회차 open 검증만 수행
    const roundRes = await pool.query(
      `SELECT status FROM live_rounds WHERE id = $1`,
      [contextId],
    );
    if (roundRes.rows[0].status !== "open") {
      throw makeError("ROUND_NOT_OPEN", 400, "회차가 종료되어 구매를 확정할 수 없습니다");
    }
    ticketEventId = null;
  }

  const actorKey = buildActorKey(userId, guestUuid);

  // 서버 경과 시간 계산 (클라이언트 값 무시 — 조작 방어).
  // 구간은 started_at(대기실 입장 = 세션 생성 시각) 부터 지금까지다. 대기열에서
  // 기다린 시간도 포함된다 — 실제 티켓팅 체감과 맞추기 위한 정의다.
  const serverElapsedMs = Math.max(
    0,
    Date.now() - new Date(session.started_at).getTime(),
  );

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    // hold 조회 및 만료 검증 (FOR UPDATE 로 잠금)
    const holdRes = await client.query(
      `SELECT lh.id AS hold_id, lh.expires_at, ls.id AS seat_id
       FROM live_holds lh
       JOIN live_seats ls ON ls.id = lh.seat_id
       WHERE lh.${contextCol} = $1 AND lh.actor_key = $2
         AND ls.seat_label = $3
       FOR UPDATE`,
      [contextId, actorKey, seatLabel],
    );
    if (holdRes.rows.length === 0 || new Date(holdRes.rows[0].expires_at) < new Date()) {
      await client.query("ROLLBACK");
      throw makeError("HOLD_EXPIRED", 409, "좌석 점유가 만료되었습니다. 다시 선택해주세요");
    }
    const { hold_id, seat_id } = holdRes.rows[0];

    // 좌석 상태 → sold, hold 삭제
    await client.query(
      `UPDATE live_seats SET status = 'sold', sold_session_id = $1 WHERE id = $2`,
      [sessionId, seat_id],
    );
    await client.query(`DELETE FROM live_holds WHERE id = $1`, [hold_id]);

    // 세션 완료 처리 (서버 계산 elapsed_ms 저장)
    await client.query(
      `UPDATE live_sessions
       SET status = 'completed',
           completed_at = NOW(),
           elapsed_ms = $1,
           seat_label = $2
       WHERE id = $3`,
      [serverElapsedMs, seatLabel, sessionDbId],
    );

    // 세션 컨텍스트 내 완료 순위 계산 (elapsed_ms ASC)
    const rankRes = await client.query(
      `SELECT COUNT(*) AS rank
       FROM live_sessions
       WHERE ${contextCol} = $1 AND status = 'completed' AND elapsed_ms <= $2`,
      [contextId, serverElapsedMs],
    );
    const rank = parseInt(rankRes.rows[0].rank, 10);

    // 티켓 개념이 제거되어 더 이상 발급물이 없다. 이벤트 세션은 신청 상태만 전이한다.
    // 유료 이벤트 TOP3 기프티콘 정산은 이제 live_sessions.elapsed_ms 를 조회 시점에
    // 정렬해서 판정한다 (settlements.service.ts 의 SETTLEMENT_BASE_CTE).
    const sessionUserId: number | null = session.user_id;

    if (isEventSession && sessionUserId != null) {
      await client.query(
        `UPDATE public.event_registrations
         SET status = 'ticketed'
         WHERE event_id = $1 AND user_id = $2 AND status IN ('pending', 'entered')`,
        [ticketEventId, sessionUserId],
      );
    }

    await client.query("COMMIT");

    emitSeatUpdate({
      seatLabel,
      status: "sold",
      contextType: isEventSession ? "event" : "round",
      contextId,
    });

    return { rankNumber: rank, elapsedMs: serverElapsedMs };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * confirmSeat의 라이브(round) 세션 경로.
 * 지금까지 Redis에만 있던 진행 중 세션을 여기서 처음이자 유일하게 Postgres에
 * INSERT한다 — "DB엔 최종 결과만" 원칙의 실제 구현 지점.
 * 좌석 동시성(hold 조회·FOR UPDATE)은 아직 Postgres 그대로 — Lua로 옮기는 건 다음 Phase.
 */
async function confirmLiveSeat(params: {
  sessionId: string;
  seatLabel: string;
  userId?: number | null;
  guestUuid?: string | null;
  record: liveSession.LiveSessionRecord;
}): Promise<ConfirmSeatResult> {
  const { sessionId, seatLabel, userId, guestUuid, record } = params;

  assertSessionOwner(
    { user_id: record.userId, guest_uuid: record.guestUuid },
    { userId, guestUuid },
  );
  if (record.status !== "active") {
    throw makeError("NOT_ACTIVE", 403, "active 상태의 세션만 구매를 확정할 수 있습니다");
  }

  const roundId = record.roundId;
  const roundRes = await pool.query(`SELECT status FROM live_rounds WHERE id = $1`, [roundId]);
  if (roundRes.rows[0].status !== "open") {
    throw makeError("ROUND_NOT_OPEN", 400, "회차가 종료되어 구매를 확정할 수 없습니다");
  }

  const actorKey = buildActorKey(userId, guestUuid);

  // 서버 경과 시간 계산 (클라이언트 값 무시 — 조작 방어). 대기열 대기 시간도 포함.
  const serverElapsedMs = Math.max(0, Date.now() - new Date(record.startedAt).getTime());

  // hold 확정은 Redis Lua가 원자적으로 판정 (만료/소유자 검증 + hold 소멸).
  // Postgres 트랜잭션을 열기 전에 먼저 확인한다 — 어차피 만료됐으면 트랜잭션 자체가 불필요.
  const holdResult = await liveSeatLock.confirmHold(roundId, seatLabel, actorKey);
  if (holdResult === "EXPIRED") {
    throw makeError("HOLD_EXPIRED", 409, "좌석 점유가 만료되었습니다. 다시 선택해주세요");
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    // status != 'sold' 가드: Redis 확정과 이 UPDATE 사이의 아주 짧은 틈에
    // 다른 확정이 끼어드는 이론적 race를 막는 안전장치 (live_seat_lock.redis.ts 참고).
    const seatRes = await client.query(
      `UPDATE live_seats SET status = 'sold', sold_session_id = $1
       WHERE round_id = $2 AND seat_label = $3 AND status != 'sold'
       RETURNING id`,
      [sessionId, roundId, seatLabel],
    );
    if (seatRes.rows.length === 0) {
      await client.query("ROLLBACK");
      throw makeError("SEAT_ALREADY_CONFIRMED", 409, "이미 판매된 좌석입니다.");
    }

    // 유일한 Postgres INSERT 지점 — 진행 중엔 없던 세션 레코드가 여기서 처음 생긴다.
    await client.query(
      `INSERT INTO live_sessions
         (session_id, round_id, user_id, guest_uuid, nickname, status, started_at, completed_at, elapsed_ms, seat_label)
       VALUES ($1, $2, $3, $4, $5, 'completed', $6, NOW(), $7, $8)`,
      [sessionId, roundId, record.userId, record.guestUuid, record.nickname, record.startedAt, serverElapsedMs, seatLabel],
    );

    const rankRes = await client.query(
      `SELECT COUNT(*) AS rank
       FROM live_sessions
       WHERE round_id = $1 AND status = 'completed' AND elapsed_ms <= $2`,
      [roundId, serverElapsedMs],
    );
    const rank = parseInt(rankRes.rows[0].rank, 10);

    await client.query("COMMIT");

    // Redis 정리는 Postgres 커밋 뒤에 — 커밋 전에 지웠다가 커밋이 실패하면
    // 최종 결과도 없고 진행 중 레코드도 없는 상태가 될 수 있다.
    await liveActive.leaveActive(roundId, sessionId);
    await liveSession.deleteSessionRecord(sessionId, roundId, record.userId, record.guestUuid);

    emitSeatUpdate({ seatLabel, status: "sold", contextType: "round", contextId: roundId });

    return { rankNumber: rank, elapsedMs: serverElapsedMs };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 6. 세션 이탈(포기)
 *
 * 사용자가 좌석 화면·대기열 오버레이에서 "나가기"를 누를 때 호출한다.
 * - active/queued 세션을 'failed' 로 종료한다 (finalizeClosedRounds 의 라운드
 *   마감 처리와 같은 상태 전이 — "완주하지 못하고 끝남"이라는 의미가 같다).
 * - active 세션이 좌석을 hold 중이었다면 hold 를 삭제하고 좌석을 available 로 되돌린다.
 * - status 를 'failed' 로 바꾸면 active_count 집계에서 즉시 빠지므로, 대기열이 있었다면
 *   promoteQueuedSessions 크론(200ms)이 다음 사람을 곧바로 승격한다.
 * - createSession 은 'queued'/'active'/'completed' 만 기존 세션으로 재사용하므로,
 *   이탈 후 재참여하면 새 sessionId·새 started_at 으로 다시 시작한다.
 *
 * completed 세션은 이미 끝난 기록이라 이탈 대상이 아니다 (409 ALREADY_COMPLETED).
 * 이미 failed 인 세션은 멱등하게 성공 처리한다 (중복 호출 방어).
 */
async function abandonSession(params: {
  sessionId: string;
  userId?: number | null;
  guestUuid?: string | null;
}): Promise<{ status: "failed" }> {
  const { sessionId, userId, guestUuid } = params;

  // 라이브(round) 세션은 queued/active 동안 Redis에만 있다 — 먼저 확인.
  const redisRecord = await liveSession.getSessionRecord(sessionId);
  if (redisRecord != null) {
    assertSessionOwner(
      { user_id: redisRecord.userId, guest_uuid: redisRecord.guestUuid },
      { userId, guestUuid },
    );

    const roundId = redisRecord.roundId;
    const actorKey = buildActorKey(userId, guestUuid);

    // 좌석 hold는 Redis Lua가 관리 — 본인 hold가 있으면 해제.
    const releasedSeatLabel = await liveSeatLock.releaseMyHold(roundId, actorKey);

    // "DB엔 최종 결과만" 원칙 — 이탈/실패는 Postgres에 흔적을 남기지 않고
    // Redis에서 완전히 지운다.
    if (redisRecord.status === "queued") {
      await liveQueue.dequeue("round", roundId, [sessionId]);
    } else {
      await liveActive.leaveActive(roundId, sessionId);
    }
    await liveSession.deleteSessionRecord(sessionId, roundId, redisRecord.userId, redisRecord.guestUuid);

    if (releasedSeatLabel != null) {
      emitSeatUpdate({
        seatLabel: releasedSeatLabel,
        status: "available",
        contextType: "round",
        contextId: roundId,
      });
    }
    if (redisRecord.status === "queued") {
      emitQueueChanged({ contextType: "round", contextId: roundId });
    }

    return { status: "failed" };
  }

  // Redis에 없음 — 이벤트 세션(이관 범위 밖) 또는 이미 completed로 끝난 라이브 세션.
  const sessionRes = await pool.query(
    `SELECT id, session_id, round_id, event_id, status, user_id, guest_uuid
     FROM live_sessions
     WHERE session_id = $1`,
    [sessionId],
  );
  if (sessionRes.rows.length === 0) {
    throw makeError("SESSION_NOT_FOUND", 404, "세션을 찾을 수 없습니다");
  }
  const session = sessionRes.rows[0];
  assertSessionOwner(session, { userId, guestUuid });

  if (session.status === "completed") {
    throw makeError("ALREADY_COMPLETED", 409, "이미 완료된 세션은 종료할 수 없습니다");
  }
  if (session.status === "failed") {
    return { status: "failed" };
  }

  const isEventSession = session.round_id == null && session.event_id != null;
  const contextCol = isEventSession ? "event_id" : "round_id";
  const contextId: number = isEventSession ? session.event_id : session.round_id;
  const actorKey = buildActorKey(userId, guestUuid);

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    // 본인 hold 가 있으면(좌석 선택 중 이탈) 해제하고 좌석을 복구한다.
    const holdRes = await client.query(
      `DELETE FROM live_holds WHERE ${contextCol} = $1 AND actor_key = $2 RETURNING seat_id`,
      [contextId, actorKey],
    );
    let releasedSeatLabel: string | null = null;
    if (holdRes.rows.length > 0) {
      const seatRes = await client.query(
        `UPDATE live_seats SET status = 'available'
         WHERE id = $1 AND status = 'held'
         RETURNING seat_label`,
        [holdRes.rows[0].seat_id],
      );
      releasedSeatLabel = seatRes.rows[0]?.seat_label ?? null;
    }

    await client.query(
      `UPDATE live_sessions
       SET status = 'failed', queue_position = NULL
       WHERE session_id = $1`,
      [sessionId],
    );

    await client.query("COMMIT");

    if (releasedSeatLabel != null) {
      emitSeatUpdate({
        seatLabel: releasedSeatLabel,
        status: "available",
        contextType: isEventSession ? "event" : "round",
        contextId,
      });
    }

    // 대기 중이던 세션이 이탈하면 뒷사람들의 live_position 이 자동으로 한 칸씩
    // 당겨지므로(ZRANK/COUNT 동적 계산), 대기열 스트림 구독자들에게 재계산을 알린다.
    if (session.status === "queued") {
      if (!isEventSession) {
        await liveQueue.dequeue("round", contextId, [sessionId]);
      }
      emitQueueChanged({ contextType: isEventSession ? "event" : "round", contextId });
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { status: "failed" };
}

/**
 * 7. SSE 연결 heartbeat
 *
 * 좌석맵을 더 이상 폴링하지 않고 SSE 로 구독만 하므로, 폴링이 대신하던
 * "보고 있다" 신호를 SSE 커넥션이 열려 있는 동안 주기적으로 대신 남겨준다.
 * (sweepStaleSessions 크론이 last_seen_at 기준으로 방치 세션을 정리하기 때문)
 */
async function touchSessionHeartbeat(sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE live_sessions SET last_seen_at = NOW() WHERE session_id = $1`,
    [sessionId],
  );
}

export {
  createSession,
  getQueueStatus,
  getSeats,
  holdSeat,
  confirmSeat,
  abandonSession,
  touchSessionHeartbeat,
};
