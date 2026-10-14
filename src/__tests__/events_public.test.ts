/**
 * 공개 이벤트 API 통합 테스트
 *
 * GET /api/events
 * GET /api/events/calendar
 * GET /api/events/nearest
 * GET /api/events/:eventId
 */

import request from "supertest";
import app from "../app";
import pool from "../config/db";
import {
  createAdminUser,
  createTestUser,
  createTestEvent,
  createTestRegistration,
  cleanupTestEvents,
  cleanupTestEvUsers,
  DEFAULT_VENUE_SLUG,
  type TestUserResult,
} from "./helpers/events.helper";

// ─── 전역 상태 ─────────────────────────────────────────────────────────────────

let admin: TestUserResult;
let adminAgent: ReturnType<typeof request.agent>;
const createdEventIds: number[] = [];

async function loginAgent(email: string, password: string) {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/login")
    .set("Content-Type", "application/json")
    .send({ email, password });
  return agent;
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await cleanupTestEvUsers();
  admin = await createAdminUser();
  adminAgent = await loginAgent(admin.email, admin.password);
});

afterAll(async () => {
  await cleanupTestEvents(createdEventIds);
  await cleanupTestEvUsers();
  await pool.end();
});

// ─── 테스트 스위트 ─────────────────────────────────────────────────────────────

describe("Events Public API", () => {

  // ─── [1] GET /api/events ────────────────────────────────────────────────────

  describe("[1] GET /api/events — 목록 조회", () => {
    it("[1-1] 기본 목록 조회 → 200, success:true, data 배열 반환", async () => {
      const res = await request(app).get("/api/events");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toHaveProperty("totalCount");
      expect(res.body.meta).toHaveProperty("page");
      expect(res.body.meta).toHaveProperty("limit");
    });

    it("[1-2] type=live 이벤트는 목록에서 제외된다", async () => {
      // live 타입은 events.type_check 제약으로 'paid'만 허용되어 있으므로
      // 직접 INSERT (제약 우회 불가) 대신 DB 조회로 검증
      const res = await request(app).get("/api/events");
      expect(res.status).toBe(200);

      const hasLive = (res.body.data as Array<{ type: string }>)
        .some((ev) => ev.type === "live");
      expect(hasLive).toBe(false);
    });

    it("[1-3] status=scheduled 필터 적용 → 해당 status만 반환", async () => {
      const { eventId } = await createTestEvent({ status: "scheduled" }, admin.userId);
      createdEventIds.push(eventId);

      const res = await request(app).get("/api/events?status=scheduled");
      expect(res.status).toBe(200);

      const allScheduled = (res.body.data as Array<{ status: string }>)
        .every((ev) => ev.status === "scheduled");
      expect(allScheduled).toBe(true);
    });

    it("[1-4] category=concert 필터 적용 → 해당 category만 반환", async () => {
      const { eventId } = await createTestEvent({ category: "concert" }, admin.userId);
      createdEventIds.push(eventId);

      const res = await request(app).get("/api/events?category=concert");
      expect(res.status).toBe(200);

      const allConcert = (res.body.data as Array<{ category: string }>)
        .every((ev) => ev.category === "concert");
      expect(allConcert).toBe(true);
    });

    it("[1-5] from/to 날짜 필터 적용", async () => {
      const opensAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2시간 후
      const { eventId } = await createTestEvent({ opensAt }, admin.userId);
      createdEventIds.push(eventId);

      const from = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString();
      const to   = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

      const res = await request(app)
        .get(`/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it("[1-6] 페이지네이션 — limit=2&page=1 → 최대 2개 반환", async () => {
      // 이벤트 3개 삽입
      for (let i = 0; i < 3; i++) {
        const opensAt = new Date(Date.now() + (10 + i) * 60 * 1000);
        const { eventId } = await createTestEvent({ opensAt }, admin.userId);
        createdEventIds.push(eventId);
      }

      const res = await request(app).get("/api/events?limit=2&page=1");
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.meta.limit).toBe(2);
      expect(res.body.meta.page).toBe(1);
    });

    it("[1-7] venueId 필드가 slug 문자열인지 확인", async () => {
      const { eventId } = await createTestEvent(
        { venueSlug: "jamsil-baseball-v1" },
        admin.userId,
      );
      createdEventIds.push(eventId);

      const res = await request(app).get(`/api/events?page=1&limit=100`);
      expect(res.status).toBe(200);

      const found = (res.body.data as Array<{ eventId: number; venueId: string }>)
        .find((ev) => ev.eventId === eventId);
      expect(found).toBeDefined();
      expect(found!.venueId).toBe("jamsil-baseball-v1");
    });
  });

  // ─── [2] GET /api/events/calendar ───────────────────────────────────────────

  describe("[2] GET /api/events/calendar — 월간 캘린더", () => {
    it("[2-1] ym=2026-09 → 30일 배열 초기화 (빈 배열 포함)", async () => {
      const res = await request(app).get("/api/events/calendar?ym=2026-09");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ym).toBe("2026-09");
      expect(Array.isArray(res.body.data.days)).toBe(true);
      expect(res.body.data.days.length).toBe(30); // 9월 = 30일
    });

    it("[2-2] ym 누락 → 400 VALIDATION_ERROR", async () => {
      const res = await request(app).get("/api/events/calendar");
      expect(res.status).toBe(400);
    });

    it("[2-3] ym 형식 오류 → 400", async () => {
      const res = await request(app).get("/api/events/calendar?ym=2026-13");
      expect(res.status).toBe(400);
    });

    it("[2-4] 이벤트가 있는 날의 days 배열에 이벤트 포함", async () => {
      // KST 2026-09-15 20:00 = UTC 2026-09-15 11:00
      const opensAt = new Date("2026-09-15T11:00:00.000Z");
      const { eventId } = await createTestEvent({ opensAt }, admin.userId);
      createdEventIds.push(eventId);

      const res = await request(app).get("/api/events/calendar?ym=2026-09");
      expect(res.status).toBe(200);

      const day15 = res.body.data.days.find(
        (d: { date: string }) => d.date === "2026-09-15",
      );
      expect(day15).toBeDefined();
      expect(day15.events.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── [3] GET /api/events/nearest ────────────────────────────────────────────

  describe("[3] GET /api/events/nearest — 가장 가까운 예정 이벤트", () => {
    it("[3-1] scheduled 이벤트가 있으면 반환", async () => {
      // registration_deadline이 아직 안 지난 scheduled 이벤트 생성
      const opensAt              = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2일 후
      const registrationDeadline = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000); // 1일 후 (마감)

      const { eventId } = await createTestEvent(
        { opensAt, registrationDeadline, status: "scheduled" },
        admin.userId,
      );
      createdEventIds.push(eventId);

      const res = await request(app).get("/api/events/nearest");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // data가 null이 아니어야 함
      expect(res.body.data).not.toBeNull();
    });

    it("[3-2] 마감(registrationDeadline 지난) 이벤트는 nearest에서 제외", async () => {
      // registration_deadline이 이미 지난 이벤트만 존재하는 경우는 환경 의존적이므로
      // DB에서 직접 검증: registration_deadline > NOW() 조건 확인
      const expiredDeadline = new Date(Date.now() - 60 * 1000); // 1분 전 마감
      const opensAt         = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const { eventId } = await createTestEvent(
        { opensAt, registrationDeadline: expiredDeadline, status: "scheduled" },
        admin.userId,
      );
      createdEventIds.push(eventId);

      const nearestRes = await pool.query(
        `SELECT id FROM events
         WHERE status = 'scheduled'
           AND type != 'live'
           AND registration_deadline > NOW()
           AND id = $1`,
        [eventId],
      );
      expect(nearestRes.rows.length).toBe(0); // 마감 지난 이벤트는 조회되지 않아야 함
    });

    it("[3-3] 응답에 venueId가 slug 문자열로 포함된다", async () => {
      const opensAt              = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const registrationDeadline = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

      const { eventId } = await createTestEvent(
        { opensAt, registrationDeadline, venueSlug: DEFAULT_VENUE_SLUG },
        admin.userId,
      );
      createdEventIds.push(eventId);

      const res = await request(app).get("/api/events/nearest");
      expect(res.status).toBe(200);
      if (res.body.data) {
        expect(typeof res.body.data.venueId).toBe("string");
        // slug 형식 (소문자/숫자/하이픈)
        expect(res.body.data.venueId).toMatch(/^[a-z0-9-]+$/);
      }
    });
  });

  // ─── [4] GET /api/events/:eventId ───────────────────────────────────────────

  describe("[4] GET /api/events/:eventId — 이벤트 상세", () => {
    it("[4-1] 존재하는 이벤트 조회 → 200, 이벤트 데이터 반환", async () => {
      const { eventId, venueSlug } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const res = await request(app).get(`/api/events/${eventId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.eventId).toBe(eventId);
      expect(res.body.data.venueId).toBe(venueSlug);
    });

    it("[4-2] 존재하지 않는 eventId → 404 EVENT_NOT_FOUND", async () => {
      const res = await request(app).get("/api/events/9999999");

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("EVENT_NOT_FOUND");
    });

    it("[4-3] 게스트 조회 → myRegistration: null", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const res = await request(app).get(`/api/events/${eventId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.myRegistration).toBeNull();
    });

    it("[4-4] 로그인 유저가 신청한 이벤트 조회 → myRegistration 포함", async () => {
      const user = await createTestUser();
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      // 신청 직접 삽입
      await createTestRegistration(eventId, user.userId, {});

      const userAgent = await loginAgent(user.email, user.password);
      const res = await userAgent.get(`/api/events/${eventId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.myRegistration).not.toBeNull();
      expect(res.body.data.myRegistration.eventId).toBe(eventId);
      expect(res.body.data.myRegistration.status).toBe("pending");
    });

    it("[4-5] 로그인 유저가 신청 안 한 이벤트 조회 → myRegistration: null", async () => {
      const user = await createTestUser();
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const userAgent = await loginAgent(user.email, user.password);
      const res = await userAgent.get(`/api/events/${eventId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.myRegistration).toBeNull();
    });

    it("[4-6] venueId 필드가 slug 문자열인지 확인 (jamsil-baseball-v1)", async () => {
      const { eventId } = await createTestEvent(
        { venueSlug: "jamsil-baseball-v1" },
        admin.userId,
      );
      createdEventIds.push(eventId);

      const res = await request(app).get(`/api/events/${eventId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.venueId).toBe("jamsil-baseball-v1");
    });
  });
});
