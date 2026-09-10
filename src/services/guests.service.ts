import pool from "../config/db";

const getMe = async (
  guestUuid: string,
): Promise<{ guestUuid: string; nickname: string } | null> => {
  // 1차: guests 테이블에서 조회
  const guestResult = await pool.query(
    `SELECT nickname FROM guests WHERE guest_uuid = $1`,
    [guestUuid],
  );
  if (guestResult.rows.length > 0) {
    return { guestUuid, nickname: guestResult.rows[0].nickname };
  }

  // 폴백: guests 테이블 생성 이전 발급된 UUID는 practice_sessions 이력에만 존재할 수 있음
  const sessionResult = await pool.query(
    `SELECT nickname FROM practice_sessions
     WHERE guest_uuid = $1
     ORDER BY started_at ASC
     LIMIT 1`,
    [guestUuid],
  );
  if (sessionResult.rows.length === 0) return null;
  return { guestUuid, nickname: sessionResult.rows[0].nickname };
};

const upsertGuest = async (
  guestUuid: string,
  nickname: string,
): Promise<void> => {
  // nickname_changed_at: 닉네임이 실제로 바뀐 경우에만 NOW() 로 갱신 (감사 로그 용도).
  await pool.query(
    `INSERT INTO guests (guest_uuid, nickname)
     VALUES ($1, $2)
     ON CONFLICT (guest_uuid)
     DO UPDATE SET
       nickname = EXCLUDED.nickname,
       updated_at = NOW(),
       nickname_changed_at = CASE
         WHEN guests.nickname IS DISTINCT FROM EXCLUDED.nickname THEN NOW()
         ELSE guests.nickname_changed_at
       END`,
    [guestUuid, nickname],
  );
};

export { getMe, upsertGuest };
