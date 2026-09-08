import pool from "../config/db";

interface DailyStats {
  completionsToday: number;
  participantsToday: number;
  fastestMsThisWeek: number | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { data: DailyStats; expiresAt: number } | null = null;

const KST_TODAY = `date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'`;
const KST_WEEK = `date_trunc('week', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'`;

const getDailyStats = async (): Promise<DailyStats> => {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.data;
  }

  // 티켓 개념이 제거되어 발급 수 대신 좌석 확정(완주) 수를 센다.
  const [completionsResult, participantsResult, fastestResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM live_sessions
       WHERE status = 'completed' AND completed_at >= ${KST_TODAY}`,
    ),
    pool.query(
      `SELECT COUNT(DISTINCT COALESCE(user_id::text, guest_uuid))::int AS count
       FROM live_sessions
       WHERE status IN ('active', 'completed')
         AND started_at >= ${KST_TODAY}`,
    ),
    pool.query(
      `SELECT MIN(elapsed_ms) AS min_ms
       FROM live_sessions
       WHERE status = 'completed' AND completed_at >= ${KST_WEEK}`,
    ),
  ]);

  const data: DailyStats = {
    completionsToday: completionsResult.rows[0].count,
    participantsToday: participantsResult.rows[0].count,
    fastestMsThisWeek:
      fastestResult.rows[0].min_ms !== null
        ? parseInt(fastestResult.rows[0].min_ms, 10)
        : null,
  };

  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
};

export { getDailyStats };
