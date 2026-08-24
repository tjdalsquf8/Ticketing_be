import cron from "node-cron";
import pool from "../config/db";
import config from "../config";
import {
  ROUND_DURATION_MINUTES,
  ensureUpcomingRounds,
  transitionRounds,
} from "../services/live.service";

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
 * 한 번에 최대 20개까지 처리한다.
 *
 * setInterval 200ms 로 등록되어 대기열이 거의 실시간으로 소진된다.
 */
const promoteQueuedSessions = async (): Promise<void> => {
  // open 회차별 active 수와 queued 수를 한 번에 조회
  const roundsRes = await pool.query(
    `SELECT id AS round_id,
            (SELECT COUNT(*) FROM live_sessions ls WHERE ls.round_id = lr.id AND ls.status = 'active') AS active_count,
            (SELECT COUNT(*) FROM live_sessions ls WHERE ls.round_id = lr.id AND ls.status = 'queued') AS queued_count
     FROM live_rounds lr
     WHERE lr.status = 'open'`,
  );

  for (const row of roundsRes.rows) {
    const roundId: number = row.round_id;
    const activeCount = parseInt(row.active_count, 10);
    const queuedCount = parseInt(row.queued_count, 10);

    if (queuedCount === 0) continue;

    const slots = Math.min(config.live.activeCapacity - activeCount, queuedCount, 20);
    if (slots <= 0) continue;

    // queue_position ASC 순으로 slots 개만큼 active 승격
    await pool.query(
      `UPDATE live_sessions
       SET status = 'active',
           queue_position = NULL,
           started_at = NOW()
       WHERE id IN (
         SELECT id FROM live_sessions
         WHERE round_id = $1 AND status = 'queued'
         ORDER BY queue_position ASC
         LIMIT $2
       )`,
      [roundId, slots],
    );
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

    // 만료된 hold 의 seat_id 를 먼저 수집하고 삭제
    const expiredRes = await client.query(
      `DELETE FROM live_holds
       WHERE expires_at < NOW()
       RETURNING seat_id`,
    );

    if (expiredRes.rows.length > 0) {
      const seatIds = expiredRes.rows.map((r: { seat_id: number }) => r.seat_id);
      await client.query(
        `UPDATE live_seats SET status = 'available'
         WHERE id = ANY($1::int[]) AND status = 'held'`,
        [seatIds],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[live/sweep-holds] failed:", err);
  } finally {
    client.release();
  }
};

// ─── finalizeClosedRounds: 기존 transitionRounds 이후 훅 ─────────────────────

/**
 * finalizeClosedRounds
 *
 * closed 전이 직후 처리:
 * 1. 잔여 seat_holds 삭제 + 좌석 held → available 복구.
 * 2. 해당 round 의 active/queued 세션 → failed.
 * 3. tickets.total_participants 를 실제 completed 세션 수로 백필.
 *
 * transitionRounds() 와 같은 타이밍 크론(TRANSITION_SCHEDULE)에 이어 실행한다.
 */
const finalizeClosedRounds = async (): Promise<void> => {
  // closed 이면서 아직 active/queued 세션이 남아 있는 회차만 대상으로
  const roundsRes = await pool.query(
    `SELECT DISTINCT lr.id AS round_id
     FROM live_rounds lr
     JOIN live_sessions ls ON ls.round_id = lr.id
     WHERE lr.status = 'closed'
       AND ls.status IN ('active', 'queued')`,
  );

  for (const row of roundsRes.rows) {
    const roundId: number = row.round_id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 잔여 hold 삭제 + 좌석 복구
      const holdRes = await client.query(
        `DELETE FROM live_holds WHERE round_id = $1 RETURNING seat_id`,
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

      // active/queued → failed
      await client.query(
        `UPDATE live_sessions SET status = 'failed'
         WHERE round_id = $1 AND status IN ('active', 'queued')`,
        [roundId],
      );

      // total_participants 백필 (completed 세션 수 기준)
      await client.query(
        `UPDATE tickets t
         SET total_participants = (
           SELECT COUNT(*) FROM live_sessions
           WHERE round_id = $1 AND status = 'completed'
         )
         WHERE t.round_id = $1`,
        [roundId],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[live/finalize] round ${roundId} failed:`, err);
    } finally {
      client.release();
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

const runFinalize = async () => {
  try {
    await finalizeClosedRounds();
  } catch (err) {
    console.error("[live/finalize] failed:", err);
  }
};

export { promoteQueuedSessions, sweepExpiredHolds, finalizeClosedRounds };

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

  console.log("[live] interval jobs registered (promote=200ms, sweep=5000ms)");
};
