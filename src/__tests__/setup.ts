import pool from "../config/db";

// 테스트 데이터 격리를 위한 접두어.
// 정리(cleanup) 쿼리에서 LIKE 패턴으로 이 접두어가 붙은 데이터만 삭제한다.
export const TEST_NICKNAME_PREFIX = "__t_";
export const TEST_EMAIL_PREFIX = "__test_";
export const TEST_USER_NAME_PREFIX = "__t_";

/**
 * 유니크한 테스트 닉네임 생성 (닉네임 규칙: 2~12자, 한글/영문/숫자/_-)
 * 예: "__t_a3b1c2" (10자)
 */
export const uniqueNickname = () =>
  `${TEST_NICKNAME_PREFIX}${Math.random().toString(36).slice(2, 8)}`;

/**
 * 유니크한 테스트 이메일 생성
 * 예: "__test_a3b1c2@test.com"
 */
export const uniqueEmail = () =>
  `${TEST_EMAIL_PREFIX}${Math.random().toString(36).slice(2, 8)}@test.com`;

/**
 * 유니크한 테스트 유저 이름 생성 (2~12자 규칙 준수)
 * 예: "__t_a3b1c2" (10자)
 */
export const uniqueUserName = () =>
  `${TEST_USER_NAME_PREFIX}${Math.random().toString(36).slice(2, 8)}`;

/**
 * 테스트가 남긴 practice_sessions 데이터 정리
 * - nickname 접두어로 식별
 */
export const cleanupTestPracticeSessions = async () => {
  await pool.query(
    `DELETE FROM practice_sessions WHERE nickname LIKE $1`,
    [`${TEST_NICKNAME_PREFIX}%`],
  );
};

/**
 * 테스트가 남긴 guests 테이블 데이터 정리
 * - nickname 접두어로 식별
 */
export const cleanupTestGuests = async () => {
  await pool.query(
    `DELETE FROM guests WHERE nickname LIKE $1`,
    [`${TEST_NICKNAME_PREFIX}%`],
  );
};

/**
 * 테스트가 남긴 users 데이터 정리 (이메일 접두어 기준)
 * - 관련된 practice_sessions도 함께 정리 (FK 참조 방지)
 */
export const cleanupTestUsers = async () => {
  await pool.query(
    `DELETE FROM practice_sessions
     WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${TEST_EMAIL_PREFIX}%`],
  );
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [
    `${TEST_EMAIL_PREFIX}%`,
  ]);
};

/**
 * pool 종료 — 마지막 테스트 파일에서만 호출 (forceExit로 대체 가능)
 */
export const closePool = async () => {
  await pool.end();
};
