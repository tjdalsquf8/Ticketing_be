import pool from "../config/db";
import { AppError } from "../middlewares/errorHandler";

const intervalMap = {
  daily: "1 day",
  weekly: "7 days",
  monthly: "30 days",
} as const;

type Period = keyof typeof intervalMap;

const getRankings = async (params: {
  mode: string;
  period: string;
  page: number;
  size: number;
  eventId?: number;
}) => {
  const { mode, period, page, size, eventId } = params;

  if (!(period in intervalMap)) {
    throw new AppError(
      400,
      "INVALID_PERIOD",
      "period는 daily, weekly, monthly 중 하나여야 합니다.",
    );
  }
  const interval = intervalMap[period as Period];
  const clampedSize = Math.min(size, 100);
  const clampedPage = Math.min(page, Math.ceil(100 / clampedSize));
  const offset = (clampedPage - 1) * clampedSize;

  const mainParams: (string | number)[] = [mode, clampedSize, offset];
  let eventFilter: string;
  if (eventId !== undefined) {
    mainParams.push(eventId);
    eventFilter = `AND event_id = $${mainParams.length}`;
  } else {
    eventFilter = "";
  }

  const result = await pool.query(
    `SELECT
       RANK() OVER (ORDER BY MIN(elapsed_ms)) AS rank,
       nickname,
       MIN(elapsed_ms) AS best_ms,
       (user_id IS NOT NULL) AS is_verified
     FROM practice_sessions
     WHERE completed_at IS NOT NULL
       AND mode = $1
       AND started_at >= NOW() - INTERVAL '${interval}'
       ${eventFilter}
     GROUP BY COALESCE(user_id::text, guest_uuid), nickname, user_id
     ORDER BY best_ms
     LIMIT $2 OFFSET $3`,
    mainParams,
  );

  const countParams: (string | number)[] = [mode];
  let countEventFilter: string;
  if (eventId !== undefined) {
    countParams.push(eventId);
    countEventFilter = `AND event_id = $${countParams.length}`;
  } else {
    countEventFilter = "";
  }

  const countResult = await pool.query(
    `SELECT COUNT(DISTINCT COALESCE(user_id::text, guest_uuid)) AS total
     FROM practice_sessions
     WHERE completed_at IS NOT NULL
       AND mode = $1
       AND started_at >= NOW() - INTERVAL '${interval}'
       ${countEventFilter}`,
    countParams,
  );

  return {
    data: result.rows,
    total: parseInt(countResult.rows[0].total),
  };
};

export { getRankings };
