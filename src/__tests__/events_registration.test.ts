/**
 * 이벤트 사전 신청 API 통합 테스트
 *
 * POST /api/events/:eventId/registrations
 * GET  /api/events/registrations/me
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
  type TestUserResult,
} from "./helpers/events.helper";

// ─── 전역 상태 ─────────────────────────────────────────────────────────────────

let admin: TestUserResult;
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
});

afterAll(async () => {
  await cleanupTestEvents(createdEventIds);
  await cleanupTestEvUsers();
});

// ─── 테스트 스위트 ─────────────────────────────────────────────────────────────

describe("Events Registration API", () => {

  // ─── [1] POST /api/events/:eventId/registrations ────────────────────────────

  describe("[1] POST /api/events/:eventId/registrations — 사전 신청", () => {
    it("[1-1] 정상 신청 → 201, registrationId 반환, registeredCount++", async () => {
      const user = await createTestUser();
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const agent = await loginAgent(user.email, user.password);
      const res = await agent
        .post(`/api/events/${eventId}/registrations`)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.registrationId).toBeGreaterThan(0);
      expect(res.body.data.status).toBe("pending");

      // registeredCount 증가 확인
      const evRes = await pool.query(
        `SELECT registered_count FROM events WHERE id = $1`,
        [eventId],
      );
      expect(evRes.rows[0].registered_count).toBe(1);
    });

    it("[1-2] 인증 없이 신청 → 401", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const res = await request(app)
        .post(`/api/events/${eventId}/registrations`)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(401);
    });

    it("[1-3] 이미 신청한 이벤트 재신청 → 409 ALREADY_REGISTERED", async () => {
      const user = await createTestUser();
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const agent = await loginAgent(user.email, user.password);

      // 첫 신청
      await agent
        .post(`/api/events/${eventId}/registrations`)
        .set("Content-Type", "application/json");

      // 두 번째 신청
      const res = await agent
        .post(`/api/events/${eventId}/registrations`)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ALREADY_REGISTERED");
    });

    it("[1-5] 마감 후 신청 → 409 REGISTRATION_CLOSED", async () => {
      const user = await createTestUser();

      // 마감이 이미 지난 이벤트
      const registrationDeadline = new Date(Date.now() - 60 * 1000); // 1분 전 마감
      const opensAt              = new Date(Date.now() + 60 * 60 * 1000);
      const { eventId } = await createTestEvent(
        { registrationDeadline, opensAt },
        admin.userId,
      );
      createdEventIds.push(eventId);

      const agent = await loginAgent(user.email, user.password);
      const res = await agent
        .post(`/api/events/${eventId}/registrations`)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("REGISTRATION_CLOSED");
    });

    it("[1-6] 취소된 이벤트 신청 → 409 EVENT_CANCEL_FORBIDDEN", async () => {
      const user = await createTestUser();
      const { eventId } = await createTestEvent({ status: "cancelled" }, admin.userId);
      createdEventIds.push(eventId);

      const agent = await loginAgent(user.email, user.password);
      const res = await agent
        .post(`/api/events/${eventId}/registrations`)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("EVENT_CANCEL_FORBIDDEN");
    });

    it("[1-7] open 상태 이벤트 신청 → 409 EVENT_ALREADY_STARTED", async () => {
      const user = await createTestUser();
      // open 상태: opensAt이 과거, closesAt이 미래
      const opensAt  = new Date(Date.now() - 10 * 60 * 1000); // 10분 전 오픈
      const { eventId } = await createTestEvent(
        { status: "open", opensAt },
        admin.userId,
      );
      createdEventIds.push(eventId);

      const agent = await loginAgent(user.email, user.password);
      const res = await agent
        .post(`/api/events/${eventId}/registrations`)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("EVENT_ALREADY_STARTED");
    });

    it("[1-8] closed 상태 이벤트 신청 → 409 EVENT_ALREADY_CLOSED", async () => {
      const user = await createTestUser();
      const opensAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2시간 전
      const { eventId } = await createTestEvent(
        { status: "closed", opensAt },
        admin.userId,
      );
      createdEventIds.push(eventId);

      const agent = await loginAgent(user.email, user.password);
      const res = await agent
        .post(`/api/events/${eventId}/registrations`)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("EVENT_ALREADY_CLOSED");
    });
  });

  // ─── [3] GET /api/events/registrations/me ───────────────────────────────────

  describe("[3] GET /api/events/registrations/me — 내 신청 목록", () => {
    it("[3-1] 내 신청 목록 조회 → 200, data 배열 + meta 반환", async () => {
      const user = await createTestUser();
      const agent = await loginAgent(user.email, user.password);

      // 이벤트 2개 신청
      for (let i = 0; i < 2; i++) {
        const opensAt = new Date(Date.now() + (i + 1) * 60 * 60 * 1000);
        const { eventId } = await createTestEvent(
          { opensAt },
          admin.userId,
        );
        createdEventIds.push(eventId);
        await agent
          .post(`/api/events/${eventId}/registrations`)
          .set("Content-Type", "application/json");
      }

      const res = await agent.get("/api/events/registrations/me");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      expect(res.body.meta).toHaveProperty("totalCount");
    });

    it("[3-2] 인증 없이 조회 → 401", async () => {
      const res = await request(app).get("/api/events/registrations/me");
      expect(res.status).toBe(401);
    });

    it("[3-3] 페이지네이션 — limit=1 → 최대 1개 반환", async () => {
      const user = await createTestUser();
      const agent = await loginAgent(user.email, user.password);

      // 이벤트 2개 신청
      for (let i = 0; i < 2; i++) {
        const opensAt = new Date(Date.now() + (i + 5) * 60 * 60 * 1000);
        const { eventId } = await createTestEvent(
          { opensAt },
          admin.userId,
        );
        createdEventIds.push(eventId);
        await agent
          .post(`/api/events/${eventId}/registrations`)
          .set("Content-Type", "application/json");
      }

      const res = await agent.get("/api/events/registrations/me?limit=1&page=1");
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.meta.limit).toBe(1);
    });

    it("[3-4] 신청 목록이 registeredAt DESC 정렬되는지 확인", async () => {
      const user = await createTestUser();
      const agent = await loginAgent(user.email, user.password);

      // 2개 신청 (순서 있게)
      const eventIds: number[] = [];
      for (let i = 0; i < 2; i++) {
        const opensAt = new Date(Date.now() + (i + 10) * 60 * 60 * 1000);
        const { eventId } = await createTestEvent(
          { opensAt },
          admin.userId,
        );
        createdEventIds.push(eventId);
        eventIds.push(eventId);
        await agent
          .post(`/api/events/${eventId}/registrations`)
          .set("Content-Type", "application/json");
      }

      const res = await agent.get("/api/events/registrations/me");
      expect(res.status).toBe(200);

      const dates = (res.body.data as Array<{ registeredAt: string }>)
        .map((d) => new Date(d.registeredAt).getTime());

      // DESC 정렬: 앞 날짜 >= 뒤 날짜
      for (let i = 0; i < dates.length - 1; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i + 1]);
      }
    });
  });
});
