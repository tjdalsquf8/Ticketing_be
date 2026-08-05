import { randomBytes } from "crypto";
import pool from "../config/db";
import { AppError } from "../middlewares/errorHandler";

const generateSessionId = () => `prc_${randomBytes(8).toString("hex")}`;

const startSession = async (params: {
  userId?: number;
  guestUuid?: string;
  nickname: string;
  mode: string;
  eventId?: number;
}) => {
  const { userId, guestUuid, nickname, mode, eventId } = params;
  const sessionId = generateSessionId();

  const result = await pool.query(
    `INSERT INTO practice_sessions (session_id, user_id, guest_uuid, nickname, mode, event_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING session_id, started_at`,
    [sessionId, userId ?? null, guestUuid ?? null, nickname, mode, eventId ?? null],
  );

  return result.rows[0];
};

const completeSession = async (params: {
  sessionId: string;
  userId?: number;
  guestUuid?: string;
}) => {
  const { sessionId, userId, guestUuid } = params;

  const session = await pool.query(
    `SELECT * FROM practice_sessions WHERE session_id = $1`,
    [sessionId],
  );

  if (session.rows.length === 0) {
    throw new AppError(404, "SESSION_NOT_FOUND", "세션을 찾을 수 없습니다.");
  }

  const s = session.rows[0];

  if (s.completed_at) {
    throw new AppError(
      409,
      "SESSION_ALREADY_COMPLETED",
      "이미 완료된 세션입니다.",
    );
  }

  if (userId && s.user_id !== userId) {
    throw new AppError(403, "SESSION_FORBIDDEN", "세션에 접근할 권한이 없습니다.");
  }
  if (!userId && guestUuid && s.guest_uuid !== guestUuid) {
    throw new AppError(403, "SESSION_FORBIDDEN", "세션에 접근할 권한이 없습니다.");
  }

  const completed = await pool.query(
    `UPDATE practice_sessions
     SET completed_at = NOW(),
         elapsed_ms = ROUND(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::int
     WHERE session_id = $1
     RETURNING elapsed_ms`,
    [sessionId],
  );

  const elapsedMs = completed.rows[0].elapsed_ms;

  const eventId: number | null = s.event_id ?? null;
  const rankParams: (number | string | null)[] = [elapsedMs, s.mode];
  const eventFilter = eventId !== null
    ? (() => { rankParams.push(eventId); return `AND event_id = $${rankParams.length}`; })()
    : "AND event_id IS NULL";

  const rank = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE best_ms > $1) AS slower,
       COUNT(*) AS total
     FROM (
       SELECT MIN(elapsed_ms) AS best_ms
       FROM practice_sessions
       WHERE completed_at IS NOT NULL AND mode = $2
         ${eventFilter}
       GROUP BY COALESCE(user_id::text, guest_uuid)
     ) best_records`,
    rankParams,
  );

  const { slower, total } = rank.rows[0];
  const totalCount = Number(total);
  const rankNumber = totalCount - Number(slower);
  const rankPercentile =
    totalCount > 0 ? Math.round((Number(slower) / totalCount) * 1000) / 10 : 0;

  return { elapsedMs, rankPercentile, rankNumber, totalCount };
};

export { startSession, completeSession };
