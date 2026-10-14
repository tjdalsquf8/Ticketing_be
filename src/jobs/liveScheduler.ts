import cron from "node-cron";
import pool from "../config/db";
import config from "../config";
import {
  ROUND_DURATION_MINUTES,
  ensureUpcomingRounds,
  transitionRounds,
} from "../services/live.service";
import { emitSeatUpdate, type SeatContextType } from "../events/seatEvents";
import { emitQueueChanged } from "../events/queueEvents";
import * as liveQueue from "../services/live_queue.redis";
import * as liveSession from "../services/live_session.redis";
import * as liveActive from "../services/live_active.redis";

const TIMEZONE = "Asia/Seoul";
const ENSURE_SCHEDULE = "0 0 * * *"; // 매일 KST 00시 (그날 24시간 회차 pre-create)
// 회차 이벤트는 매 시각 :00 (open) 과 :ROUND_DURATION_MINUTES (close) 두 번만 발생.
// 크론을 이 두 분에만 트리거해 하루 폴링을 1,440 → 48회로 압축하면서도 지연 0을 유지한다.
// ROUND_DURATION_MINUTES 가 0 이거나 60 이상이 되면 크론 표현식이 깨지므로 방어.
if (
  !Number.isInteger(ROUND_DURATION_MINUTES) ||
  ROUND_DURATION_MINUTES <= 0 ||
  ROUND_DURATION_MINUTES >= 60
) {
  throw new Error(
    `[liveScheduler] ROUND_DURATION_MINUTES must be integer in (0,60), got ${ROUND_DURATION_MINUTES}`,
  );
}
const TRANSITION_SCHEDULE = `0,${ROUND_DURATION_MINUTES} * * * *`;

const runEnsure = async (fromMidnight: boolean = false) => {
  try {
    await ensureUpcomingRounds(fromMidnight);
  } catch (err) {
    console.error("[live/ensure] failed:", err);
  }
};

const runTransition = async () => {
  try {
    await transitionRounds();
  } catch (err) {
    console.error("[live/transition] failed:", err);
  }
};

// ─── 대기열 승격 크론 (200ms interval) ────────────────────────────────────────

/**
 * promoteQueuedSessions
 *
 * 각 open 회차별로 active 정원(ACTIVE_CAPACITY)에 여유가 생기면
 * queued 세션 중 queue_position ASC 순서로 빈 자리만큼 active 로 승격한다.
 * 정원이 이미 activeCapacity(env, 1~1000)로 상한이 걸려있어 별도 배치 상한을
 * 두지 않는다 — 정원까지는 한 tick에 다 채운다.
 *
 * setInterval 200ms 로 등록되어 대기열이 거의 실시간으로 소진된다.
 *
 * started_at 은 승격 시 건드리지 않는다. 소요 시간(elapsed_ms) 정의가
 * "대기실 입장(세션 생성) 부터 좌석 확정까지" 라서 대기열에서 기다린 시간도
 * 기록에 포함되어야 하기 때문이다. 예전에는 여기서 started_at = NOW() 로
 * 재설정해 대기 시간을 기록에서 빼고 있었다.
 */
const promoteQueuedSessions = async (): Promise<void> => {
  // 열린 회차 목록만 Postgres에서 가져온다 (round 메타데이터는 계속 Postgres).
  // 대기열/활성 상태는 "DB엔 최종 결과만" 원칙에 따라 전부 Redis에 있다.
  const roundsRes = await pool.query(
    `SELECT id AS round_id FROM live_rounds WHERE status = 'open'`,
  );

  for (const row of roundsRes.rows) {
    const roundId: number = row.round_id;

    const activeCount = await liveActive.activeCount(roundId);
    let slots = config.live.activeCapacity - activeCount;
    if (slots <= 0) continue;
    // 스윕 테스트용 상한. 0(기본)이면 무제한 — activeCapacity 여유만큼 한 tick에 다 채운다.
    if (config.live.promoteBatchCap > 0) {
      slots = Math.min(slots, config.live.promoteBatchCap);
    }

    // Redis ZSET에서 맨 앞 slots명의 sessionId를 먼저 뽑는다 (정렬은 Redis가 이미 해둔 상태).
    const frontSessionIds = await liveQueue.peekFront("round", roundId, slots);
    if (frontSessionIds.length === 0) continue;

    // 활성 집합에 추가 + 각 세션 레코드 status를 active로 변경 + 큐에서 제거.
    // Postgres는 전혀 건드리지 않는다 — 승격은 confirm 전까지 "최종 결과"가 아니다.
    await liveActive.addActive(roundId, frontSessionIds);
    await Promise.all(frontSessionIds.map((id) => liveSession.updateStatus(id, "active")));
    await liveQueue.dequeue("round", roundId, frontSessionIds);

    // 승격된 사람들은 물론, 남은 대기자들도 live_position 이 한 칸씩 당겨지므로
    // 대기열 스트림 구독자 전원에게 재계산을 알린다.
    emitQueueChanged({ contextType: "round", contextId: roundId });
  }
};

// ─── 만료 hold 정리 크론 (5000ms interval) ───────────────────────────────────

/**
 * sweepExpiredHolds
 *
 * expires_at 이 현재 시각보다 과거인 live_holds 를 삭제하고
 * 대응되는 live_seats 의 status 를 'held' → 'available' 로 복구한다.
 * 트랜잭션으로 처리해 hold 삭제와 좌석 복구가 원자적으로 이루어진다.
 */
const sweepExpiredHolds = async (): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 만료된 hold 를 삭제하며 좌석 label·컨텍스트를 함께 수집 (SSE emit 용)
    const expiredRes = await client.query(
      `DELETE FROM live_holds lh
       USING live_seats ls
       WHERE lh.seat_id = ls.id
         AND lh.expires_at < NOW()
       RETURNING ls.id AS seat_id, ls.seat_label, ls.round_id, ls.event_id`,
    );

    if (expiredRes.rows.length > 0) {
      const seatIds = expiredRes.rows.map(
        (r: { seat_id: number }) => r.seat_id,
      );
      await client.query(
        `UPDATE live_seats SET status = 'available'
         WHERE id = ANY($1::int[]) AND status = 'held'`,
        [seatIds],
      );
    }

    await client.query("COMMIT");

    for (const row of expiredRes.rows) {
      emitSeatUpdate({
        seatLabel: row.seat_label,
        status: "available",
        contextType: row.round_id != null ? "round" : "event",
        contextId: row.round_id ?? row.event_id,
      });
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[live/sweep-holds] failed:", err);
  } finally {
    client.release();
  }
};

// ─── 방치된 세션 정리 크론 (5000ms interval) ─────────────────────────────────

/**
 * sweepStaleSessions
 *
 * 탭 강제 종료·네트워크 끊김 등으로 취소(abandon) 호출 없이 방치된 queued/active
 * 세션을 정리한다. hold 요청·대기열/좌석 SSE 스트림 연결(연결 중 touchSessionHeartbeat
 * 주기 호출)마다 last_seen_at 이 갱신되므로, 이 값이 sessionHeartbeatTtlSeconds 이상
 * 오래된 queued/active 세션은 더 이상 화면을 보고 있지 않은 것으로 간주해 failed 처리한다.
 *
 * active 세션이 정리되면 active_count 집계에서 빠지므로 promoteQueuedSessions
 * 크론이 다음 대기자를 승격한다. queued 세션이 정리되면 뒷사람 순번도 자연히 당겨진다.
 */
const sweepStaleSessions = async (): Promise<void> => {
  // 이벤트 세션(아직 이관 범위 밖, 계속 Postgres) — round 세션은 이제 Postgres에
  // queued/active로 존재하지 않으므로 이 쿼리는 자연히 event만 건드린다.
  const staleRes = await pool.query(
    `UPDATE live_sessions
     SET status = 'failed', queue_position = NULL
     WHERE status IN ('active', 'queued')
       AND last_seen_at < NOW() - ($1 * INTERVAL '1 second')
     RETURNING round_id, event_id`,
    [config.live.sessionHeartbeatTtlSeconds],
  );

  const notified = new Set<string>();
  for (const row of staleRes.rows) {
    const contextType: SeatContextType =
      row.round_id != null ? "round" : "event";
    const contextId: number = row.round_id ?? row.event_id;
    const key = `${contextType}:${contextId}`;
    if (notified.has(key)) continue;
    notified.add(key);
    emitQueueChanged({ contextType, contextId });
  }

  // 라이브(round) 세션 — Redis heartbeat ZSET 기준으로 방치 세션 찾아 정리.
  // "DB엔 최종 결과만" 원칙이라 완료 못 한 세션은 Postgres에 흔적 없이 그냥 지운다.
  const cutoffMs = Date.now() - config.live.sessionHeartbeatTtlSeconds * 1000;
  const staleSessionIds = await liveSession.findStaleSessionIds(cutoffMs);
  const notifiedRounds = new Set<number>();

  for (const sessionId of staleSessionIds) {
    const record = await liveSession.getSessionRecord(sessionId);
    if (record == null) {
      // 레코드는 이미 없는데 heartbeat 색인에만 남은 고아 항목 — 색인만 정리
      await liveSession.removeFromHeartbeat(sessionId);
      continue;
    }

    if (record.status === "queued") {
      await liveQueue.dequeue("round", record.roundId, [sessionId]);
    } else {
      await liveActive.leaveActive(record.roundId, sessionId);
    }
    await liveSession.deleteSessionRecord(sessionId, record.roundId, record.userId, record.guestUuid);

    if (!notifiedRounds.has(record.roundId)) {
      notifiedRounds.add(record.roundId);
      emitQueueChanged({ contextType: "round", contextId: record.roundId });
    }
  }
};

// ─── finalizeClosedRounds: 기존 transitionRounds 이후 훅 ─────────────────────

/**
 * finalizeClosedRounds
 *
 * closed 전이 직후 처리:
 * 1. 잔여 seat_holds 삭제 + 좌석 held → available 복구.
 * 2. 해당 round 의 active/queued 세션 → failed.
 *
 * transitionRounds() 와 같은 타이밍 크론(TRANSITION_SCHEDULE)에 이어 실행한다.
 */
const finalizeClosedRounds = async (): Promise<void> => {
  // 라이브 세션은 이제 Postgres에 queued/active로 안 남으니, "아직 세션이 남은
  // 회차"를 Postgres join으로 찾을 수 없다. 대신 "최근에 닫힌 회차"를 후보로 보고
  // Redis 쪽에 잔여 큐/활성 세션이 있는지 직접 확인한다.
  const roundsRes = await pool.query(
    `SELECT id AS round_id FROM live_rounds
     WHERE status = 'closed' AND closes_at > NOW() - INTERVAL '1 hour'`,
  );

  for (const row of roundsRes.rows) {
    const roundId: number = row.round_id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 잔여 hold 삭제 + 좌석 복구 (seat_label 도 함께 수집 — SSE emit 용)
      const holdRes = await client.query(
        `DELETE FROM live_holds lh
         USING live_seats ls
         WHERE lh.round_id = $1
           AND lh.seat_id = ls.id
         RETURNING ls.id AS seat_id, ls.seat_label`,
        [roundId],
      );
      if (holdRes.rows.length > 0) {
        const seatIds = holdRes.rows.map((r: { seat_id: number }) => r.seat_id);
        await client.query(
          `UPDATE live_seats SET status = 'available'
           WHERE id = ANY($1::int[]) AND status = 'held'`,
          [seatIds],
        );
      }

      await client.query("COMMIT");

      for (const row of holdRes.rows) {
        emitSeatUpdate({
          seatLabel: row.seat_label,
          status: "available",
          contextType: "round",
          contextId: roundId,
        });
      }
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[live/finalize] round ${roundId} failed:`, err);
      continue;
    } finally {
      client.release();
    }

    // Redis 잔여 큐/활성 세션 정리 — 완료 못 한 세션은 "DB엔 최종 결과만" 원칙상
    // 흔적 없이 그냥 지운다.
    const queuedIds = await liveQueue.allMembers("round", roundId);
    const activeIds = await liveActive.members(roundId);
    for (const sessionId of [...queuedIds, ...activeIds]) {
      const record = await liveSession.getSessionRecord(sessionId);
      if (record != null) {
        await liveSession.deleteSessionRecord(sessionId, roundId, record.userId, record.guestUuid);
      } else {
        await liveSession.removeFromHeartbeat(sessionId);
      }
    }
    await liveQueue.clearRound("round", roundId);
    await liveActive.clearRound(roundId);

    if (queuedIds.length > 0 || activeIds.length > 0) {
      emitQueueChanged({ contextType: "round", contextId: roundId });
    }
  }
};

const runPromote = async () => {
  try {
    await promoteQueuedSessions();
  } catch (err) {
    console.error("[live/promote] failed:", err);
  }
};

const runSweep = async () => {
  try {
    await sweepExpiredHolds();
  } catch (err) {
    console.error("[live/sweep] failed:", err);
  }
};

const runSweepStaleSessions = async () => {
  try {
    await sweepStaleSessions();
  } catch (err) {
    console.error("[live/sweep-sessions] failed:", err);
  }
};

const runFinalize = async () => {
  try {
    await finalizeClosedRounds();
  } catch (err) {
    console.error("[live/finalize] failed:", err);
  }
};

// ─── 임의 시각 회차 종료 예약 ────────────────────────────────────────────────

/**
 * scheduleRoundClose
 *
 * 특정 회차의 closes_at 에 맞춰 일회성 종료 타이머를 건다.
 *
 * 정각 회차는 TRANSITION_SCHEDULE(매시 :00 과 :ROUND_DURATION_MINUTES) 크론이
 * 지연 없이 닫아준다. 그러나 create-now 처럼 임의 시각에 만들어진 회차는 그 두
 * 발화 시점 사이에서 종료되므로 다음 정각까지 최대 한 시간 가까이 open 으로 남는다.
 * 해당 회차만 정확한 시각에 닫기 위한 보완 타이머.
 *
 * - 크론이 백스톱으로 남아 있으므로 서버 재시작으로 타이머가 사라져도 결국 닫힌다.
 * - DB/앱 시계 오차로 `closes_at <= NOW()` 가 아직 거짓일 수 있어 1초 여유를 둔다.
 * - 회차 길이(ROUND_DURATION_MINUTES)만큼만 대기하므로 setTimeout 상한 걱정 없음.
 */
const scheduleRoundClose = (roundId: number, closesAt: Date): void => {
  if (process.env.NODE_ENV === "test") return;

  const closeRound = async (): Promise<void> => {
    try {
      const res = await pool.query(
        `UPDATE live_rounds SET status = 'closed'
         WHERE id = $1 AND status = 'open' AND closes_at <= NOW()`,
        [roundId],
      );
      if ((res.rowCount ?? 0) > 0) {
        console.log(`[live/scheduler] round ${roundId} → closed`);
      }
      // 잔여 hold 정리 + active/queued 세션 failed 전이 + total_participants 백필
      await finalizeClosedRounds();
    } catch (err) {
      console.error(`[live/scheduler] closeRound(${roundId}) failed:`, err);
    }
  };

  const delay = closesAt.getTime() - Date.now() + 1000;
  if (delay <= 0) {
    void closeRound();
    return;
  }
  setTimeout(() => void closeRound(), delay);
};

export {
  promoteQueuedSessions,
  sweepExpiredHolds,
  sweepStaleSessions,
  finalizeClosedRounds,
  scheduleRoundClose,
};

export const startLiveScheduler = () => {
  if (process.env.NODE_ENV === "test") return;

  cron.schedule(ENSURE_SCHEDULE, () => runEnsure(true), { timezone: TIMEZONE });
  cron.schedule(TRANSITION_SCHEDULE, runTransition, { timezone: TIMEZONE });
  cron.schedule(TRANSITION_SCHEDULE, runFinalize, { timezone: TIMEZONE });
  console.log(
    `[live] scheduler registered (ensure=${ENSURE_SCHEDULE}, transition=${TRANSITION_SCHEDULE}, tz=${TIMEZONE})`,
  );

  // 서버 시작 즉시 1회 실행: 오늘 남은 정각(다음 정각~KST 23시)만 채움
  void runEnsure(false);
  void runTransition();
  void runFinalize();

  // setInterval 기반 고빈도 작업 등록
  setInterval(() => void runPromote(), 200);
  setInterval(() => void runSweep(), 5000);
  setInterval(() => void runSweepStaleSessions(), 5000);

  console.log(
    "[live] interval jobs registered (promote=200ms, sweep=5000ms, sweep-sessions=5000ms)",
  );
};
