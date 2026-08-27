import cron from "node-cron";
import pool from "../config/db";

const CLEANUP_SCHEDULE = "0 4 * * *";
const TIMEZONE = "Asia/Seoul";

/**
 * 하루 1회(KST 04시) 오래된 세션·게스트 데이터를 정리한다.
 *
 * 정리 대상:
 *   1) practice_sessions 완료 세션 (기존)
 *      → completed_at 기준 30일 지난 것.
 *   2) practice_sessions 미완료 세션
 *      → started_at 기준 30일 지난 것. 세션 시작만 하고 방치된 로우 누적 방지.
 *   3) live_sessions 게스트 세션
 *      → guest_uuid 가 있는 completed/failed 세션 중 30일 지난 것.
 *   4) guests 계정
 *      → updated_at 기준 30일 무활동 게스트 삭제.
 *
 * 배경:
 *   게스트가 닉네임을 바꾸면 guest_uuid 쿠키가 리셋되어 새 UUID 를 발급받고
 *   이전 UUID 로 남긴 데이터는 "유령 데이터"가 된다. 랭킹 조회는 이미
 *   `started_at >= NOW() - 30 days` 필터로 30일 이후 자동 소멸하지만, DB 에는
 *   실물이 남아 팽창을 유발한다. 본 크론이 그 실물을 함께 정리한다.
 *
 *   guests 테이블을 참조하는 FK 는 없으므로 삭제 순서에 의한 참조 위반은 없다.
 */
const runCleanup = async () => {
  try {
    const r1 = await pool.query(
      `DELETE FROM practice_sessions
       WHERE completed_at IS NOT NULL
         AND completed_at < NOW() - INTERVAL '30 days'`,
    );

    const r2 = await pool.query(
      `DELETE FROM practice_sessions
       WHERE completed_at IS NULL
         AND started_at < NOW() - INTERVAL '30 days'`,
    );

    const r3 = await pool.query(
      `DELETE FROM live_sessions
       WHERE guest_uuid IS NOT NULL
         AND status IN ('completed', 'failed')
         AND started_at < NOW() - INTERVAL '30 days'`,
    );

    const r4 = await pool.query(
      `DELETE FROM guests
       WHERE updated_at < NOW() - INTERVAL '30 days'`,
    );

    console.log(
      `[cleanup] ${new Date().toISOString()} - ` +
      `practice(completed)=${r1.rowCount}, ` +
      `practice(incomplete)=${r2.rowCount}, ` +
      `live(guest)=${r3.rowCount}, ` +
      `guests=${r4.rowCount}`,
    );
  } catch (err) {
    console.error("[cleanup] failed:", err);
  }
};

export const startCleanupCron = () => {
  cron.schedule(CLEANUP_SCHEDULE, runCleanup, { timezone: TIMEZONE });
  console.log(`[cleanup] cron registered (${CLEANUP_SCHEDULE} ${TIMEZONE})`);
};
