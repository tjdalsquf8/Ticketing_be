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
import { redis } from "../../config/redis";
import * as liveSession from "../../services/live_session.redis";
import * as liveQueue from "../../services/live_queue.redis";
import * as liveActive from "../../services/live_active.redis";
import * as liveSeatLock from "../../services/live_seat_lock.redis";

// ─── 상수 ────────────────────────────────────────────────────────────────────

export const TEST_LIVE_EMAIL_PREFIX = "__test_live_";
const DEFAULT_VENUE_ID = 1;   // kspo-dome-v1 (seed venue)
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
  // live_sessions → users 순서로 삭제 (FK)
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
}

export interface TestRound {
  roundId: number;
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
  } = opts;

  const res = await pool.query(
    `INSERT INTO live_rounds (opens_at, closes_at, seat_labels, status, venue_id)
     VALUES (
       NOW() + make_interval(secs => $1),
       NOW() + make_interval(secs => $2),
       $3::jsonb,
       $4,
       $5
     )
     RETURNING id`,
    [opensOffsetSeconds, closesOffsetSeconds, JSON.stringify(seatLabels), status, DEFAULT_VENUE_ID],
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

  return { roundId, seatLabels };
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

// ─── Redis 기반 라이브 세션/좌석락 헬퍼 ─────────────────────────────────────
//
// createSession 이후 round 세션은 Postgres가 아닌 Redis에 queued/active로
// 존재한다. 기존 insertTestSession(Postgres 직접 INSERT)은 세션 "존재"는
// 흉내낼 수 있지만(Postgres 폴백 경로로 조회됨), 대기열 순번·활성 정원·좌석
// hold 같은 실제 "진행 중" 상태는 Redis에만 있으므로 이 헬퍼들로 채운다.

export interface InsertRedisSessionOptions {
  roundId: number;
  userId?: number | null;
  guestUuid?: string | null;
  nickname?: string;
  status?: "queued" | "active";
}

/** Redis에 라이브 세션 레코드를 직접 만든다 (대기열/활성 집합에도 등록). */
export async function insertRedisLiveSession(
  opts: InsertRedisSessionOptions,
): Promise<{ sessionId: string }> {
  const { roundId, userId = null, guestUuid = null, nickname = "__tlv_guest", status = "active" } = opts;
  const sessionId = crypto.randomBytes(10).toString("hex");

  await liveSession.createSessionRecord({ sessionId, roundId, userId, guestUuid, nickname, status });
  if (status === "active") {
    await liveActive.addActive(roundId, [sessionId]);
  } else {
    await liveQueue.enqueue("round", roundId, sessionId);
  }

  return { sessionId };
}

/** Redis 좌석 hold를 직접 건다 (실제 holdSeat과 같은 Lua 스크립트 재사용). */
export async function insertRedisSeatHold(
  roundId: number,
  seatLabel: string,
  actorKey: string,
  ttlMs = 30000,
): Promise<void> {
  await liveSeatLock.tryHold(roundId, seatLabel, actorKey, ttlMs);
}

/** actorKey 형식 테스트 헬퍼 (서비스의 buildActorKey와 동일 규칙). */
export function testActorKey(opts: { userId?: number | null; guestUuid?: string | null }): string {
  return opts.userId != null ? `user:${opts.userId}` : `guest:${opts.guestUuid}`;
}

// ─── 테스트 데이터 전체 정리 ─────────────────────────────────────────────────

/** roundId 목록에 해당하는 모든 데이터 삭제 (Postgres + Redis) */
export async function cleanupTestRounds(roundIds: number[]): Promise<void> {
  if (roundIds.length === 0) return;

  for (const roundId of roundIds) {
    // Redis: 큐/활성 집합에 남은 세션 레코드 정리
    const queuedIds = await liveQueue.allMembers("round", roundId);
    const activeIds = await liveActive.members(roundId);
    for (const sessionId of [...queuedIds, ...activeIds]) {
      const record = await liveSession.getSessionRecord(sessionId);
      if (record != null) {
        await liveSession.deleteSessionRecord(sessionId, roundId, record.userId, record.guestUuid);
      } else {
        await liveSession.removeFromHeartbeat(sessionId);
      }
    }
    await liveQueue.clearRound("round", roundId);
    await liveActive.clearRound(roundId);

    // Redis: 좌석락/내hold 키 정리 (패턴 스캔)
    for (const prefix of [`seat:round:${roundId}:`, `myhold:round:${roundId}:`]) {
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
        cursor = next;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== "0");
    }
  }

  await pool.query(
    `DELETE FROM live_rounds WHERE id = ANY($1::int[])`,
    [roundIds],
  );
}
