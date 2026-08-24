/**
 * 실시간 티켓팅 통합 테스트용 헬퍼
 *
 * - 테스트 전용 라운드/좌석/세션/hold 직접 삽입
 * - afterEach/afterAll 에서 호출할 정리 함수 제공
 * - 모든 테스트 데이터는 `__test_live__` 로 식별
 */

import crypto from "crypto";
import pool from "../../config/db";
import bcrypt from "bcrypt";

// ─── 상수 ────────────────────────────────────────────────────────────────────

export const TEST_LIVE_EMAIL_PREFIX = "__test_live_";
const DEFAULT_EVENT_ID = 1005; // live_config.default_event_id
const TEST_SEAT_LABELS = ["A-1-1", "A-1-2", "A-1-3", "A-1-4", "A-1-5"];

// ─── 사용자 헬퍼 ─────────────────────────────────────────────────────────────

/** 테스트용 사용자 생성 후 { userId, email, accessToken } 반환 */
export async function createTestUser(): Promise<{
  userId: number;
  email: string;
  password: string;
  name: string;
}> {
  const rand = crypto.randomBytes(5).toString("hex");
  const email = `${TEST_LIVE_EMAIL_PREFIX}${rand}@test.com`;
  const password = "test1234!";
  const name = `__tlv_${rand}`;
  const hashed = await bcrypt.hash(password, 10);

  const res = await pool.query(
    `INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id`,
    [email, hashed, name],
  );

  return { userId: res.rows[0].id, email, password, name };
}

/** 테스트용 사용자들 일괄 삭제 (이메일 접두어 기준) */
export async function cleanupTestLiveUsers(): Promise<void> {
  // tickets → live_sessions → users 순서로 삭제 (FK)
  await pool.query(
    `DELETE FROM tickets
     WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${TEST_LIVE_EMAIL_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM live_sessions
     WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${TEST_LIVE_EMAIL_PREFIX}%`],
  );
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [
    `${TEST_LIVE_EMAIL_PREFIX}%`,
  ]);
}

// ─── 라운드 헬퍼 ─────────────────────────────────────────────────────────────

export interface TestRoundOptions {
  status?: "scheduled" | "open" | "closed" | "cancelled";
  /** opens_at offset in seconds from NOW (기본 -60: 이미 시작된 상태) */
  opensOffsetSeconds?: number;
  /** closes_at offset in seconds from NOW (기본 +300: 5분 후 종료) */
  closesOffsetSeconds?: number;
  seatLabels?: string[];
  eventId?: number;
}

export interface TestRound {
  roundId: number;
  eventId: number;
  seatLabels: string[];
}

/**
 * 테스트용 라운드 직접 삽입
 * status='open' 이면 live_seats 도 같이 생성
 */
export async function createTestRound(
  opts: TestRoundOptions = {},
): Promise<TestRound> {
  const {
    status = "open",
    opensOffsetSeconds = -60,
    closesOffsetSeconds = 300,
    seatLabels = TEST_SEAT_LABELS,
    eventId = DEFAULT_EVENT_ID,
  } = opts;

  const res = await pool.query(
    `INSERT INTO live_rounds (opens_at, closes_at, event_id, seat_labels, status)
     VALUES (
       NOW() + make_interval(secs => $1),
       NOW() + make_interval(secs => $2),
       $3,
       $4::jsonb,
       $5
     )
     RETURNING id`,
    [opensOffsetSeconds, closesOffsetSeconds, eventId, JSON.stringify(seatLabels), status],
  );

  const roundId: number = res.rows[0].id;

  if (status === "open") {
    // live_seats 벌크 삽입
    for (const label of seatLabels) {
      await pool.query(
        `INSERT INTO live_seats (round_id, seat_label) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [roundId, label],
      );
    }
  }

  return { roundId, eventId, seatLabels };
}

/** 라운드와 관련 데이터 모두 삭제 (CASCADE 활용) */
export async function deleteTestRound(roundId: number): Promise<void> {
  await pool.query(`DELETE FROM live_rounds WHERE id = $1`, [roundId]);
}

// ─── 세션 헬퍼 ───────────────────────────────────────────────────────────────

export interface InsertSessionOptions {
  roundId: number;
  userId?: number | null;
  guestUuid?: string | null;
  nickname?: string;
  status?: "queued" | "active" | "completed" | "failed";
  queuePosition?: number | null;
  elapsedMs?: number | null;
  seatLabel?: string | null;
}

/** live_sessions 직접 삽입 후 session_id 반환 */
export async function insertTestSession(
  opts: InsertSessionOptions,
): Promise<{ sessionId: string; sessionDbId: number }> {
  const {
    roundId,
    userId = null,
    guestUuid = null,
    nickname = "__tlv_guest",
    status = "active",
    queuePosition = null,
    elapsedMs = null,
    seatLabel = null,
  } = opts;

  const sessionId = crypto.randomBytes(10).toString("hex");

  const res = await pool.query(
    `INSERT INTO live_sessions
       (session_id, round_id, user_id, guest_uuid, nickname, status, queue_position, elapsed_ms, seat_label, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     RETURNING id`,
    [sessionId, roundId, userId, guestUuid, nickname, status, queuePosition, elapsedMs, seatLabel],
  );

  return { sessionId, sessionDbId: res.rows[0].id };
}

// ─── Hold 헬퍼 ───────────────────────────────────────────────────────────────

export interface InsertHoldOptions {
  roundId: number;
  seatLabel: string;
  actorKey: string;
  /** 만료까지 초 (기본 30, 음수면 이미 만료) */
  ttlSeconds?: number;
}

/** live_holds + live_seats(held) 직접 삽입 */
export async function insertTestHold(
  opts: InsertHoldOptions,
): Promise<{ holdId: number; seatId: number; expiresAt: Date }> {
  const { roundId, seatLabel, actorKey, ttlSeconds = 30 } = opts;

  const seatRes = await pool.query(
    `SELECT id FROM live_seats WHERE round_id = $1 AND seat_label = $2`,
    [roundId, seatLabel],
  );
  if (seatRes.rows.length === 0) {
    throw new Error(`[insertTestHold] seat not found: ${seatLabel} in round ${roundId}`);
  }
  const seatId: number = seatRes.rows[0].id;

  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await pool.query(
    `UPDATE live_seats SET status = 'held' WHERE id = $1`,
    [seatId],
  );

  const holdRes = await pool.query(
    `INSERT INTO live_holds (round_id, seat_id, actor_key, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (round_id, actor_key) DO UPDATE
       SET seat_id = EXCLUDED.seat_id,
           expires_at = EXCLUDED.expires_at,
           created_at = NOW()
     RETURNING id`,
    [roundId, seatId, actorKey, expiresAt.toISOString()],
  );

  return { holdId: holdRes.rows[0].id, seatId, expiresAt };
}

/** hold 만료 시뮬레이션: expires_at 을 과거로 UPDATE */
export async function expireHold(actorKey: string, roundId: number): Promise<void> {
  await pool.query(
    `UPDATE live_holds SET expires_at = NOW() - INTERVAL '1 minute'
     WHERE actor_key = $1 AND round_id = $2`,
    [actorKey, roundId],
  );
}

// ─── 테스트 데이터 전체 정리 ─────────────────────────────────────────────────

/** roundId 목록에 해당하는 모든 데이터 삭제 */
export async function cleanupTestRounds(roundIds: number[]): Promise<void> {
  if (roundIds.length === 0) return;
  await pool.query(
    `DELETE FROM live_rounds WHERE id = ANY($1::int[])`,
    [roundIds],
  );
}
