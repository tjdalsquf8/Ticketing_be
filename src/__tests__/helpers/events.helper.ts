/**
 * 이벤트 통합 테스트용 헬퍼
 *
 * - 테스트 전용 유저/이벤트/신청 직접 삽입
 * - afterAll 에서 호출할 정리 함수 제공
 * - 모든 테스트 데이터는 "__test_ev_" 접두어로 식별
 */

import crypto from "crypto";
import pool from "../../config/db";
import bcrypt from "bcrypt";

// ─── 상수 ────────────────────────────────────────────────────────────────────

export const TEST_EV_EMAIL_PREFIX = "__test_ev_";
export const DEFAULT_VENUE_SLUG   = "kspo-dome-v1";

// ─── 사용자 헬퍼 ─────────────────────────────────────────────────────────────

export interface TestUserResult {
  userId: number;
  email: string;
  password: string;
  name: string;
}

/** 테스트용 일반 유저 생성 (포인트 지정 가능) */
export async function createTestUserWithPoints(points = 0): Promise<TestUserResult> {
  const rand     = crypto.randomBytes(5).toString("hex");
  const email    = `${TEST_EV_EMAIL_PREFIX}${rand}@test.com`;
  const password = "test1234!";
  const name     = `__tev_${rand}`;
  const hashed   = await bcrypt.hash(password, 10);

  const res = await pool.query(
    `INSERT INTO users (email, password, name, points)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [email, hashed, name, points],
  );

  return { userId: res.rows[0].id as number, email, password, name };
}

/** 테스트용 관리자 유저 생성 */
export async function createAdminUser(): Promise<TestUserResult> {
  const rand     = crypto.randomBytes(5).toString("hex");
  const email    = `${TEST_EV_EMAIL_PREFIX}admin_${rand}@test.com`;
  const password = "test1234!";
  const name     = `__tev_admin_${rand}`;
  const hashed   = await bcrypt.hash(password, 10);

  const res = await pool.query(
    `INSERT INTO users (email, password, name, role, points)
     VALUES ($1, $2, $3, 'admin', 10000)
     RETURNING id`,
    [email, hashed, name],
  );

  return { userId: res.rows[0].id as number, email, password, name };
}

// ─── 이벤트 헬퍼 ─────────────────────────────────────────────────────────────

export interface CreateTestEventOptions {
  status?: "scheduled" | "open" | "closed" | "cancelled";
  opensAt?: Date;
  durationMs?: number;
  entryFeePoints?: number;
  category?: string;
  registrationDeadline?: Date;
  venueSlug?: string;
  createdBy?: number;
  seriesId?: number | null;
}

export interface TestEventResult {
  eventId: number;
  venueSlug: string;
  entryFeePoints: number;
}

/**
 * 테스트 이벤트 직접 삽입
 * venueSlug로 venue PK 조회 후 INSERT
 */
export async function createTestEvent(
  opts: CreateTestEventOptions = {},
  adminUserId: number,
): Promise<TestEventResult> {
  const {
    status         = "scheduled",
    durationMs     = 300000,
    entryFeePoints = 500,
    category       = "concert",
    venueSlug      = DEFAULT_VENUE_SLUG,
    seriesId       = null,
  } = opts;

  const venueRes = await pool.query(
    `SELECT id, total_seats FROM venues WHERE slug = $1`,
    [venueSlug],
  );
  if (venueRes.rows.length === 0) {
    throw new Error(`[createTestEvent] venue not found: ${venueSlug}`);
  }
  const venueId   = venueRes.rows[0].id as number;
  const totalSeats = venueRes.rows[0].total_seats as number;

  // opensAt: 기본적으로 지금+30분 (scheduled 기본값)
  const opensAt = opts.opensAt ?? new Date(Date.now() + 30 * 60 * 1000);
  const closesAt = new Date(opensAt.getTime() + durationMs);

  // registrationDeadline: 기본 지금+1시간 (신청 마감이 아직 안 된 상태)
  // 단, opensAt 보다 앞이어야 비즈니스 룰에 맞으므로 min(opensAt-1min, now+1h) 사용
  const defaultDeadline = new Date(
    Math.min(opensAt.getTime() - 60 * 1000, Date.now() + 60 * 60 * 1000),
  );
  const registrationDeadline = opts.registrationDeadline ?? defaultDeadline;

  const rand  = crypto.randomBytes(3).toString("hex");
  const title = `__tev_event_${rand}`;

  const res = await pool.query(
    `INSERT INTO events
       (type, title, category, venue_id, total_seats, opens_at, closes_at,
        duration_ms, entry_fee_points, registration_deadline, prize,
        poster_color, poster_initial, status, series_id, created_by)
     VALUES ('paid', $1, $2, $3, $4, $5, $6, $7, $8, $9, 'test prize', '#123456', 'T', $10, $11, $12)
     RETURNING id`,
    [
      title, category, venueId, totalSeats,
      opensAt.toISOString(), closesAt.toISOString(),
      durationMs, entryFeePoints, registrationDeadline.toISOString(),
      status, seriesId, adminUserId,
    ],
  );

  return {
    eventId:       res.rows[0].id as number,
    venueSlug,
    entryFeePoints,
  };
}

// ─── 신청 헬퍼 ───────────────────────────────────────────────────────────────

/** 테스트용 신청 직접 삽입 (status 지정 가능) */
export async function createTestRegistration(
  eventId: number,
  userId: number,
  opts: {
    status?: string;
    pointsPaid?: number;
  } = {},
): Promise<{ registrationId: number }> {
  const { status = "pending", pointsPaid = 500 } = opts;

  const res = await pool.query(
    `INSERT INTO event_registrations (event_id, user_id, points_paid, status)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [eventId, userId, pointsPaid, status],
  );

  return { registrationId: res.rows[0].id as number };
}

// ─── 정리 헬퍼 ───────────────────────────────────────────────────────────────

/** 테스트 이벤트와 관련 데이터 모두 삭제 */
export async function cleanupTestEvents(eventIds: number[]): Promise<void> {
  if (eventIds.length === 0) return;

  // FK 의존 순서 (역방향 삭제):
  //   live_seats/live_holds → event_registrations → tickets → live_sessions → events
  // event_registrations.ticket_id → tickets(id) FK 추가 이후, tickets 삭제 전
  // event_registrations 를 먼저 지워야 참조 위반 없음. tickets → live_sessions
  // FK 때문에 tickets 를 live_sessions 보다 먼저.
  await pool.query(
    `DELETE FROM live_seats WHERE event_id = ANY($1::int[])`,
    [eventIds],
  );
  await pool.query(
    `DELETE FROM live_holds WHERE event_id = ANY($1::int[])`,
    [eventIds],
  );
  await pool.query(
    `DELETE FROM event_registrations WHERE event_id = ANY($1::int[])`,
    [eventIds],
  );
  await pool.query(
    `DELETE FROM tickets WHERE live_session_id IN
       (SELECT id FROM live_sessions WHERE event_id = ANY($1::int[]))`,
    [eventIds],
  );
  await pool.query(
    `DELETE FROM live_sessions WHERE event_id = ANY($1::int[])`,
    [eventIds],
  );
  await pool.query(
    `DELETE FROM events WHERE id = ANY($1::int[])`,
    [eventIds],
  );
}

/** 테스트 시리즈 삭제 */
export async function cleanupTestSeries(seriesIds: number[]): Promise<void> {
  if (seriesIds.length === 0) return;

  // 시리즈 소속 이벤트 ID 조회
  const res = await pool.query(
    `SELECT id FROM events WHERE series_id = ANY($1::int[])`,
    [seriesIds],
  );
  const eventIds = res.rows.map((r) => r.id as number);
  await cleanupTestEvents(eventIds);

  await pool.query(
    `DELETE FROM event_series WHERE id = ANY($1::int[])`,
    [seriesIds],
  );
}

/** 테스트 유저 삭제 (이메일 접두어 기준) */
export async function cleanupTestEvUsers(): Promise<void> {
  // FK 의존 순서: event_registrations → tickets → live_sessions → events → users
  // event_registrations.ticket_id → tickets(id) FK 추가로 event_registrations 를
  // tickets 보다 먼저 지워야 참조 위반이 안 남.
  await pool.query(
    `DELETE FROM event_registrations
     WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${TEST_EV_EMAIL_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM tickets
     WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${TEST_EV_EMAIL_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM live_sessions
     WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${TEST_EV_EMAIL_PREFIX}%`],
  );
  // 테스트 유저가 생성한 이벤트 삭제 (created_by FK)
  const evRes = await pool.query(
    `SELECT id FROM events
     WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${TEST_EV_EMAIL_PREFIX}%`],
  );
  if (evRes.rows.length > 0) {
    const ids = evRes.rows.map((r) => r.id as number);
    await cleanupTestEvents(ids);
  }
  // event_series
  await pool.query(
    `DELETE FROM event_series
     WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${TEST_EV_EMAIL_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM users WHERE email LIKE $1`,
    [`${TEST_EV_EMAIL_PREFIX}%`],
  );
}
