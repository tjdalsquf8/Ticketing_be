import pool from "../config/db";

interface DailyStats {
  ticketsIssuedToday: number;
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

  const [ticketsResult, participantsResult, fastestResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS count FROM tickets WHERE issued_at >= ${KST_TODAY}`,
    ),
    pool.query(
      `SELECT COUNT(DISTINCT COALESCE(user_id::text, guest_uuid))::int AS count
       FROM live_sessions
       WHERE status IN ('active', 'completed')
         AND started_at >= ${KST_TODAY}`,
    ),
    pool.query(
      `SELECT MIN(elapsed_ms) AS min_ms FROM tickets WHERE issued_at >= ${KST_WEEK}`,
    ),
  ]);

  const data: DailyStats = {
    ticketsIssuedToday: ticketsResult.rows[0].count,
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
