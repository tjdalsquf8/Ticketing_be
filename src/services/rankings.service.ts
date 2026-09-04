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
  period?: string;
  page: number;
  size: number;
  eventId?: number;
}) => {
  const { mode, page, size } = params;

  if (mode === "ticket") {
    const clampedSizeTicket = Math.min(size, 100);
    const clampedPageTicket = Math.min(page, Math.ceil(100 / clampedSizeTicket));
    const offsetTicket = (clampedPageTicket - 1) * clampedSizeTicket;

    const result = await pool.query(
      `SELECT
         RANK() OVER (ORDER BY COUNT(*) DESC) AS rank,
         u.id AS "userId",
         u.name AS nickname,
         COUNT(*) AS "ticketCount"
       FROM tickets t
       JOIN users u ON u.id = t.user_id
       WHERE t.round_id IS NOT NULL
       GROUP BY u.id, u.name
       ORDER BY COUNT(*) DESC
       LIMIT $1 OFFSET $2`,
      [clampedSizeTicket, offsetTicket],
    );

    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT user_id) AS total FROM tickets WHERE round_id IS NOT NULL`,
    );

    return {
      data: result.rows,
      total: parseInt(countResult.rows[0].total),
    };
  }

  const { period, eventId } = params;

  if (!period || !(period in intervalMap)) {
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

  if (mode === "live") {
    const mainParams: (string | number)[] = [clampedSize, offset];
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
       FROM live_sessions
       WHERE status = 'completed'
         AND started_at >= NOW() - INTERVAL '${interval}'
         ${eventFilter}
       GROUP BY COALESCE(user_id::text, guest_uuid), nickname, user_id
       ORDER BY best_ms
       LIMIT $1 OFFSET $2`,
      mainParams,
    );

    const countParams: (string | number)[] = [];
    let countEventFilter: string;
    if (eventId !== undefined) {
      countParams.push(eventId);
      countEventFilter = `AND event_id = $${countParams.length}`;
    } else {
      countEventFilter = "";
    }

    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT COALESCE(user_id::text, guest_uuid)) AS total
       FROM live_sessions
       WHERE status = 'completed'
         AND started_at >= NOW() - INTERVAL '${interval}'
         ${countEventFilter}`,
      countParams,
    );

    return {
      data: result.rows,
      total: parseInt(countResult.rows[0].total),
    };
  }

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
       AND ranking_eligible = true
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
       AND ranking_eligible = true
       ${countEventFilter}`,
    countParams,
  );

  return {
    data: result.rows,
    total: parseInt(countResult.rows[0].total),
  };
};

export { getRankings };
