/**
 * 이벤트 사전 신청 / 취소 API 통합 테스트
 *
 * POST   /api/events/:eventId/registrations
 * DELETE /api/events/:eventId/registrations/me
 * GET    /api/events/registrations/me
 */

import request from "supertest";
import app from "../app";
import pool from "../config/db";
import {
  createAdminUser,
  createTestUserWithTickets,
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
    it("[1-1] 정상 신청 → 201, registrationId 반환, 포인트 차감, registeredCount++", async () => {
      const fee  = 500;
      const user = await createTestUserWithTickets(1000);
      const { eventId } = await createTestEvent({ entryFeeTickets: fee }, admin.userId);
      createdEventIds.push(eventId);

      const agent = await loginAgent(user.email, user.password);
      const res = await agent
        .post(`/api/events/${eventId}/registrations`)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.registrationId).toBeGreaterThan(0);
      expect(res.body.data.status).toBe("pending");

      // 포인트 차감 확인
      const ticketsRes = await pool.query(
        `SELECT tickets FROM users WHERE id = $1`,
        [user.userId],
      );
      expect(ticketsRes.rows[0].tickets).toBe(1000 - fee);

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
      const user = await createTestUserWithTickets(2000);
      const { eventId } = await createTestEvent({ entryFeeTickets: 500 }, admin.userId);
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

    it("[1-4] 보유 티켓 부족 → 409 INSUFFICIENT_TICKETS", async () => {
      const user = await createTestUserWithTickets(100); // 티켓 잔액 부족
      const { eventId } = await createTestEvent({ entryFeeTickets: 500 }, admin.userId);
      createdEventIds.push(eventId);

      const agent = await loginAgent(user.email, user.password);
      const res = await agent
        .post(`/api/events/${eventId}/registrations`)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("INSUFFICIENT_TICKETS");
    });

    it("[1-5] 마감 후 신청 → 409 REGISTRATION_CLOSED", async () => {
      const user = await createTestUserWithTickets(1000);

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
      const user = await createTestUserWithTickets(1000);
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
      const user = await createTestUserWithTickets(1000);
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
      const user = await createTestUserWithTickets(1000);
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

  // ─── [2] DELETE /api/events/:eventId/registrations/me ───────────────────────

  describe("[2] DELETE /api/events/:eventId/registrations/me — 신청 취소", () => {
    it("[2-1] 정상 취소 → 200, 포인트 환불, registeredCount--", async () => {
      const fee  = 500;
      const user = await createTestUserWithTickets(1000);
      const { eventId } = await createTestEvent({ entryFeeTickets: fee }, admin.userId);
      createdEventIds.push(eventId);

      const agent = await loginAgent(user.email, user.password);

      // 신청
      await agent
        .post(`/api/events/${eventId}/registrations`)
        .set("Content-Type", "application/json");

      // 취소
      const res = await agent
        .delete(`/api/events/${eventId}/registrations/me`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("cancelled");

      // 포인트 환불 확인
      const ticketsRes = await pool.query(
        `SELECT tickets FROM users WHERE id = $1`,
        [user.userId],
      );
      expect(ticketsRes.rows[0].tickets).toBe(1000); // 원상 복귀

      // registeredCount 감소 확인
      const evRes = await pool.query(
        `SELECT registered_count FROM events WHERE id = $1`,
        [eventId],
      );
      expect(evRes.rows[0].registered_count).toBe(0);
    });

    it("[2-2] 오픈 이후(opens_at 지난) 취소 → 409 CANCEL_NOT_ALLOWED", async () => {
      const user = await createTestUserWithTickets(1000);

      // opens_at이 이미 지난 이벤트 (status는 여전히 scheduled로 설정하여
      // 신청은 가능하지만 취소 불가 조건 테스트)
      const opensAt              = new Date(Date.now() - 5 * 60 * 1000); // 5분 전 오픈
      const registrationDeadline = new Date(Date.now() + 60 * 60 * 1000); // 1시간 후 마감

      const { eventId } = await createTestEvent(
        { status: "scheduled", opensAt, registrationDeadline },
        admin.userId,
      );
      createdEventIds.push(eventId);

      // 직접 신청 INSERT (등록 API는 open/scheduled 상태 검사가 있으므로)
      await createTestRegistration(eventId, user.userId, { ticketsPaid: 500 });
      await pool.query(
        `UPDATE users SET tickets = tickets - 500 WHERE id = $1`,
        [user.userId],
      );

      const agent = await loginAgent(user.email, user.password);
      const res = await agent
        .delete(`/api/events/${eventId}/registrations/me`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CANCEL_NOT_ALLOWED");
    });

    it("[2-3] 신청 없이 취소 → 404 REGISTRATION_NOT_FOUND", async () => {
      const user = await createTestUserWithTickets(1000);
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const agent = await loginAgent(user.email, user.password);
      const res = await agent
        .delete(`/api/events/${eventId}/registrations/me`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("REGISTRATION_NOT_FOUND");
    });

    it("[2-4] 인증 없이 취소 → 401", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const res = await request(app)
        .delete(`/api/events/${eventId}/registrations/me`);

      expect(res.status).toBe(401);
    });
  });

  // ─── [3] GET /api/events/registrations/me ───────────────────────────────────

  describe("[3] GET /api/events/registrations/me — 내 신청 목록", () => {
    it("[3-1] 내 신청 목록 조회 → 200, data 배열 + meta 반환", async () => {
      const user = await createTestUserWithTickets(5000);
      const agent = await loginAgent(user.email, user.password);

      // 이벤트 2개 신청
      for (let i = 0; i < 2; i++) {
        const opensAt = new Date(Date.now() + (i + 1) * 60 * 60 * 1000);
        const { eventId } = await createTestEvent(
          { entryFeeTickets: 500, opensAt },
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
      const user = await createTestUserWithTickets(5000);
      const agent = await loginAgent(user.email, user.password);

      // 이벤트 2개 신청
      for (let i = 0; i < 2; i++) {
        const opensAt = new Date(Date.now() + (i + 5) * 60 * 60 * 1000);
        const { eventId } = await createTestEvent(
          { entryFeeTickets: 500, opensAt },
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
      const user = await createTestUserWithTickets(5000);
      const agent = await loginAgent(user.email, user.password);

      // 2개 신청 (순서 있게)
      const eventIds: number[] = [];
      for (let i = 0; i < 2; i++) {
        const opensAt = new Date(Date.now() + (i + 10) * 60 * 60 * 1000);
        const { eventId } = await createTestEvent(
          { entryFeeTickets: 500, opensAt },
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
