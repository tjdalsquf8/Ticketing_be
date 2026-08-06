import pool from "../config/db";

const getMe = async (
  guestUuid: string,
): Promise<{ guestUuid: string; nickname: string } | null> => {
  const result = await pool.query(
    `SELECT nickname FROM practice_sessions
     WHERE guest_uuid = $1
     ORDER BY started_at ASC
     LIMIT 1`,
    [guestUuid],
  );
  if (result.rows.length === 0) return null;
  return { guestUuid, nickname: result.rows[0].nickname };
};

export { getMe };
