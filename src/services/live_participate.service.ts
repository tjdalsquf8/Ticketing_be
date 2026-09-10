import crypto from "crypto";
import pool from "../config/db";
import config from "../config";
import type { PoolClient } from "pg";

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface CreateSessionParams {
  roundId: number;
  userId?: number | null;
  guestUuid?: string | null;
  nickname: string;
}

export interface CreateSessionResult {
  sessionId: string;
  status: "active" | "queued";
  queuePosition: number | null;
  startedAt: string;
}

export interface QueueStatusResult {
  sessionId: string;
  status: string;
  queuePosition: number | null;
  ready: boolean;
}

export interface SeatRow {
  seatLabel: string;
  status: "available" | "held" | "sold";
}

export interface GetSeatsResult {
  seats: SeatRow[];
  myHold: { seatLabel: string; expiresAt: string } | null;
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

// ─── 서비스 함수 ─────────────────────────────────────────────────────────────

/**
 * 1. 티켓팅 세션 생성
 *
 * 사용자가 "참여하기" 버튼을 누를 때 호출된다.
 * - 회차(round)가 open 상태인지 확인한다.
 * - 이미 참여 중인 세션이 있으면 그 세션을 그대로 반환한다 (중복 참여 방지).
 * - 없으면 현재 active 세션 수를 확인해:
 *   · 정원(ACTIVE_CAPACITY) 미만이면 즉시 active 상태로 입장.
 *   · 정원 초과면 queued 상태로 대기열에 등록한다.
 * - 반환값으로 sessionId, status(active/queued), 대기 순번, 입장 시각을 돌려준다.
 */
async function createSession(
  params: CreateSessionParams,
): Promise<CreateSessionResult> {
  const { roundId, userId, guestUuid, nickname } = params;

  // 회차 상태 확인
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

  // 기존 세션 조회 (partial unique index 활용 — 이미 queued/active/completed 중 하나면 반환)
  let existingRes;
  if (userId != null) {
    existingRes = await pool.query(
      `SELECT session_id, status, queue_position, started_at
       FROM live_sessions
       WHERE round_id = $1 AND user_id = $2
         AND status IN ('queued','active','completed')`,
      [roundId, userId],
    );
  } else {
    existingRes = await pool.query(
      `SELECT session_id, status, queue_position, started_at
       FROM live_sessions
       WHERE round_id = $1 AND guest_uuid = $2
         AND status IN ('queued','active','completed')`,
      [roundId, guestUuid],
    );
  }

  if (existingRes.rows.length > 0) {
    const row = existingRes.rows[0];
    return {
      sessionId: row.session_id,
      status: row.status,
      queuePosition: row.queue_position ?? null,
      startedAt: row.started_at,
    };
  }

  // 게스트끼리 닉네임이 겹쳐도 참여를 막지 않는다.
  // 신원은 guest_uuid 로 구분되고(리더보드 dedup 키도 guest_uuid), 본인 기록·등수는
  // 자기 세션 기준으로 따로 조회되므로 동명이인이 있어도 서로 섞이지 않는다.
  // 예전에는 회차 내 중복을 409 NICKNAME_TAKEN_IN_ROUND 로 거절했다.

  // session_id 생성 (12자 hex)
  const sessionId = crypto.randomBytes(10).toString("hex");

  const activeCapacity = config.live.activeCapacity;

  // active INSERT 시도: 정원 여유가 있을 때만 성공 (원자적 조건부 INSERT)
  const activeResult = await pool.query(
    `INSERT INTO live_sessions
       (session_id, round_id, user_id, guest_uuid, nickname, status, started_at)
     SELECT $1, $2, $3, $4, $5, 'active', NOW()
     WHERE (
       SELECT COUNT(*) FROM live_sessions
       WHERE round_id = $2 AND status = 'active'
     ) < $6
     RETURNING session_id, status, queue_position, started_at`,
    [sessionId, roundId, userId ?? null, guestUuid ?? null, nickname, activeCapacity],
  );

  if ((activeResult.rowCount ?? 0) > 0) {
    const inserted = activeResult.rows[0];
    return {
      sessionId: inserted.session_id,
      status: inserted.status,
      queuePosition: inserted.queue_position ?? null,
      startedAt: inserted.started_at,
    };
  }

  // 정원 초과 → queued INSERT (queue_position 원자적 계산)
  const queuedResult = await pool.query(
    `INSERT INTO live_sessions
       (session_id, round_id, user_id, guest_uuid, nickname, status, queue_position, started_at)
     VALUES ($1, $2, $3, $4, $5, 'queued',
       (SELECT COALESCE(MAX(queue_position), 0) + 1
        FROM live_sessions
        WHERE round_id = $2 AND status = 'queued'),
       NOW())
     RETURNING session_id, status, queue_position, started_at`,
    [sessionId, roundId, userId ?? null, guestUuid ?? null, nickname],
  );

  const queued = queuedResult.rows[0];
  return {
    sessionId: queued.session_id,
    status: queued.status,
    queuePosition: queued.queue_position ?? null,
    startedAt: queued.started_at,
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

  const res = await pool.query(
    `SELECT session_id, status, queue_position, user_id, guest_uuid
     FROM live_sessions
     WHERE session_id = $1`,
    [sessionId],
  );

  if (res.rows.length === 0) {
    throw makeError("SESSION_NOT_FOUND", 404, "세션을 찾을 수 없습니다");
  }

  const session = res.rows[0];
  assertSessionOwner(session, { userId, guestUuid });

  // queued 상태일 때만 동적 순번 계산 (앞 사람 승격 시 자동 반영)
  let livePosition: number | null = null;
  if (session.status === "queued" && session.queue_position != null) {
    const posRes = await pool.query(
      `SELECT COUNT(*)::int + 1 AS live_position
       FROM live_sessions
       WHERE round_id = (
         SELECT round_id FROM live_sessions WHERE session_id = $1
       )
         AND status = 'queued'
         AND queue_position < $2`,
      [sessionId, session.queue_position],
    );
    livePosition = posRes.rows[0].live_position as number;
  }

  return {
    sessionId: session.session_id,
    status: session.status,
    queuePosition: livePosition,
    ready: session.status === "active",
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

  if (session.status !== "active") {
    throw makeError("NOT_ACTIVE", 403, "active 상태의 세션만 좌석을 조회할 수 있습니다");
  }

  const actorKey = buildActorKey(userId, guestUuid);

  // round_id(라이브) 또는 event_id(이벤트) 기반으로 분기
  const isEventSession = session.round_id == null && session.event_id != null;
  const contextCol = isEventSession ? "event_id" : "round_id";
  const contextId: number = isEventSession ? session.event_id : session.round_id;

  // 좌석 목록 조회
  const seatsRes = await pool.query(
    `SELECT seat_label, status FROM live_seats WHERE ${contextCol} = $1 ORDER BY seat_label ASC`,
    [contextId],
  );

  // 본인 hold 조회
  const holdRes = await pool.query(
    `SELECT ls.seat_label, lh.expires_at
     FROM live_holds lh
     JOIN live_seats ls ON ls.id = lh.seat_id
     WHERE lh.${contextCol} = $1 AND lh.actor_key = $2`,
    [contextId, actorKey],
  );

  const myHold =
    holdRes.rows.length > 0
      ? {
          seatLabel: holdRes.rows[0].seat_label,
          expiresAt: holdRes.rows[0].expires_at,
        }
      : null;

  return {
    seats: seatsRes.rows.map((r) => ({
      seatLabel: r.seat_label,
      status: r.status,
    })),
    myHold,
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

  // 세션 조회
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

  if (session.status !== "active") {
    throw makeError("NOT_ACTIVE", 403, "active 상태의 세션만 좌석을 점유할 수 있습니다");
  }

  // round_id(라이브) 또는 event_id(이벤트) 기반으로 분기
  const isEventSession = session.round_id == null && session.event_id != null;
  const contextCol = isEventSession ? "event_id" : "round_id";
  const contextId: number = isEventSession ? session.event_id : session.round_id;

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

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── 락 순서 정렬 (데드락 방지) ───────────────────────────────────────────
    // PostgreSQL 은 FOR UPDATE 를 LEFT JOIN 의 nullable 쪽에 적용할 수 없다.
    // 따라서 2단계로 처리한다:
    //   1) 기존 본인 hold seat_id 를 FOR UPDATE 없이 조회
    //   2) 대상 좌석 seat_id + 기존 hold seat_id 를 id ASC 순서로 FOR UPDATE 획득
    // 모든 트랜잭션이 항상 낮은 seat_id 부터 락을 획득하므로 순환 대기가 발생하지 않는다.

    // 1) 기존 본인 hold 조회 (락 없음, seat_id 파악 목적)
    const prevHoldLookup = await client.query(
      `SELECT lh.id AS hold_id, lh.seat_id AS prev_seat_id
       FROM live_holds lh
       WHERE lh.${contextCol} = $1 AND lh.actor_key = $2`,
      [contextId, actorKey],
    );
    const prevHold = prevHoldLookup.rows[0] ?? null;

    // 2) 대상 좌석 id 조회 (락 없음)
    // 이벤트 세션: live_seats 레코드가 없으면 upsert (FE가 좌석 카탈로그 소유)
    if (isEventSession) {
      await client.query(
        `INSERT INTO live_seats (event_id, seat_label)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [contextId, seatLabel],
      );
    }

    const targetSeatLookup = await client.query(
      `SELECT id FROM live_seats WHERE ${contextCol} = $1 AND seat_label = $2`,
      [contextId, seatLabel],
    );
    if (targetSeatLookup.rows.length === 0) {
      await client.query("ROLLBACK");
      throw makeError("SEAT_NOT_FOUND", 404, "좌석을 찾을 수 없습니다");
    }
    const targetSeatId: number = targetSeatLookup.rows[0].id;

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
 * - 세션을 completed 로 처리하고 경과 시간을 기록한다.
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

  // 세션 조회 (started_at 포함 — 서버 경과 시간 계산용)
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

  // 서버 경과 시간 계산 (클라이언트 값 무시 — 조작 방어)
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

    return { rankNumber: rank, elapsedMs: serverElapsedMs };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export { createSession, getQueueStatus, getSeats, holdSeat, confirmSeat };
