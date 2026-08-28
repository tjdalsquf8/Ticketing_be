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
  // nickname_changed_at: 닉네임이 실제로 바뀐 경우에만 NOW() 로 갱신.
  // 같은 nickname 재요청(예: 프론트가 페이지 로드마다 POST /api/guests 호출)에서는
  // 이전 값을 유지해서 1시간 대기 카운트가 리셋되지 않도록 한다.
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

/**
 * 닉네임 변경 대기 시간 검사에 필요한 nickname_changed_at 조회.
 * 게스트가 존재하지 않으면 null.
 */
const getNicknameChangedAt = async (
  guestUuid: string,
): Promise<Date | null> => {
  const res = await pool.query(
    `SELECT nickname_changed_at FROM guests WHERE guest_uuid = $1`,
    [guestUuid],
  );
  if (res.rows.length === 0) return null;
  return res.rows[0].nickname_changed_at as Date;
};

export { getMe, upsertGuest, getNicknameChangedAt };
