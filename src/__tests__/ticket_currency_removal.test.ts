/**
 * 티켓 재화(구 포인트) 제거 회귀 테스트
 *
 * 유료 이벤트 참가비가 기획에서 빠지면서 잔액·차감·환불 개념이 모두 사라졌다.
 * 사전 신청은 로그인 유저면 누구나 무료로 가능하고, 신청 취소 API 는 삭제됐다.
 *
 * 이 파일은 "없어졌다"는 사실 자체를 고정한다. 컬럼/필드/엔드포인트가 되살아나면
 * 여기서 먼저 깨진다.
 *
 * 검증 대상:
 *   - DB: users.tickets, events.entry_fee_tickets, event_series.entry_fee_tickets,
 *         event_registrations.tickets_paid/refund_tickets/refunded_at 부재
 *   - DB: event_registrations.status CHECK 에서 'refunded' 거부
 *   - POST /events/:eventId/registrations — 잔액 검사 없이 신청 성공
 *   - DELETE /events/:eventId/registrations/me — 라우트 삭제됨
 *   - POST /admin/events/:eventId/cancel — 신청 전원 cancelled 로 무효화
 *   - 응답 페이로드에서 재화 관련 필드 제거 (ticketBalance/entryFeeTickets/netRevenue 등)
 *   - 관리자 이벤트 생성·수정에서 entryFeeTickets 는 무시 (Mass Assignment 방어)
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

/** 현재 시각 기준 N분 후 ISO 문자열 */
function futureISO(plusMinutes: number): string {
  return new Date(Date.now() + plusMinutes * 60 * 1000).toISOString();
}

/** information_schema 로 컬럼 존재 여부 확인 */
async function columnExists(table: string, column: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return (res.rowCount ?? 0) > 0;
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await cleanupTestEvUsers();
  admin      = await createAdminUser();
  adminAgent = await loginAgent(admin.email, admin.password);
});

afterAll(async () => {
  await cleanupTestEvents(createdEventIds);
  await cleanupTestEvUsers();
  await pool.end();
});

// ─── 테스트 스위트 ─────────────────────────────────────────────────────────────

describe("티켓 재화 제거", () => {

  // ─── [1] 스키마 ───────────────────────────────────────────────────────────────

  describe("[1] 스키마 — 재화 컬럼 제거", () => {
    it("[1-1] users.tickets 컬럼 없음", async () => {
      expect(await columnExists("users", "tickets")).toBe(false);
    });

    it("[1-2] events/event_series.entry_fee_tickets 컬럼 없음", async () => {
      expect(await columnExists("events", "entry_fee_tickets")).toBe(false);
      expect(await columnExists("event_series", "entry_fee_tickets")).toBe(false);
    });

    it("[1-3] event_registrations 의 결제·환불 컬럼 없음", async () => {
      expect(await columnExists("event_registrations", "tickets_paid")).toBe(false);
      expect(await columnExists("event_registrations", "refund_tickets")).toBe(false);
      expect(await columnExists("event_registrations", "refunded_at")).toBe(false);
    });

    it("[1-4] status CHECK 가 'refunded' 를 거부", async () => {
      const user = await createTestUser();
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      await expect(
        pool.query(
          `INSERT INTO event_registrations (event_id, user_id, status)
           VALUES ($1, $2, 'refunded')`,
          [eventId, user.userId],
        ),
      ).rejects.toThrow(/event_registrations_status_check/);
    });
  });

  // ─── [2] 사전 신청 ────────────────────────────────────────────────────────────

  describe("[2] POST /api/events/:eventId/registrations — 무료 신청", () => {
    it("[2-1] 잔액 개념 없이 신청 성공 → 201, 응답에 재화 필드 없음", async () => {
      const user = await createTestUser();
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const agent = await loginAgent(user.email, user.password);
      const res = await agent
        .post(`/api/events/${eventId}/registrations`)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("pending");
      expect(res.body.data).not.toHaveProperty("ticketsPaid");
      expect(res.body.data).not.toHaveProperty("refundTickets");
      expect(res.body.data).not.toHaveProperty("refundedAt");
      expect(res.body.data).not.toHaveProperty("ticketId");
    });

    it("[2-2] 로그인 유저면 몇 명이 신청해도 모두 성공 (잔액 소진 없음)", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      for (let i = 0; i < 3; i++) {
        const user  = await createTestUser();
        const agent = await loginAgent(user.email, user.password);
        const res = await agent
          .post(`/api/events/${eventId}/registrations`)
          .set("Content-Type", "application/json");

        expect(res.status).toBe(201);
      }

      const evRes = await pool.query(
        `SELECT registered_count FROM events WHERE id = $1`,
        [eventId],
      );
      expect(evRes.rows[0].registered_count).toBe(3);
    });

    it("[2-3] 비로그인 신청은 여전히 401", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const res = await request(app)
        .post(`/api/events/${eventId}/registrations`)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(401);
    });
  });

  // ─── [3] 신청 취소 라우트 제거 ────────────────────────────────────────────────

  describe("[3] DELETE /api/events/:eventId/registrations/me — 삭제됨", () => {
    it("[3-1] 신청한 유저가 호출해도 404 (라우트 없음)", async () => {
      const user = await createTestUser();
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);
      await createTestRegistration(eventId, user.userId);

      const agent = await loginAgent(user.email, user.password);
      const res = await agent.delete(`/api/events/${eventId}/registrations/me`);

      expect(res.status).toBe(404);

      // 신청은 그대로 pending 유지 — 취소 부작용이 없어야 한다
      const regRes = await pool.query(
        `SELECT status FROM event_registrations WHERE event_id = $1 AND user_id = $2`,
        [eventId, user.userId],
      );
      expect(regRes.rows[0].status).toBe("pending");
    });
  });

  // ─── [4] 관리자 이벤트 취소 ───────────────────────────────────────────────────

  describe("[4] POST /api/admin/events/:eventId/cancel — 환불 없이 무효화", () => {
    it("[4-1] pending 신청 전원 cancelled + cancelled_at 세팅", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const users = [
        await createTestUser(),
        await createTestUser(),
      ];
      for (const u of users) {
        await createTestRegistration(eventId, u.userId);
      }

      const res = await adminAgent
        .post(`/api/admin/events/${eventId}/cancel`)
        .set("Content-Type", "application/json")
        .send({ reason: "회귀 테스트" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("cancelled");

      const regRes = await pool.query(
        `SELECT status, cancelled_at FROM event_registrations WHERE event_id = $1`,
        [eventId],
      );
      expect(regRes.rowCount).toBe(2);
      for (const row of regRes.rows) {
        expect(row.status).toBe("cancelled");
        expect(row.cancelled_at).not.toBeNull();
      }
    });

    it("[4-2] pending 아닌 신청은 건드리지 않음", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const user = await createTestUser();
      await createTestRegistration(eventId, user.userId, { status: "ticketed" });

      await adminAgent
        .post(`/api/admin/events/${eventId}/cancel`)
        .set("Content-Type", "application/json")
        .send({ reason: "회귀 테스트" });

      const regRes = await pool.query(
        `SELECT status FROM event_registrations WHERE event_id = $1 AND user_id = $2`,
        [eventId, user.userId],
      );
      expect(regRes.rows[0].status).toBe("ticketed");
    });
  });

  // ─── [5] 응답 페이로드 ────────────────────────────────────────────────────────

  describe("[5] 응답에서 재화 필드 제거", () => {
    it("[5-1] GET /api/users/me 에 ticketBalance 없음", async () => {
      const user  = await createTestUser();
      const agent = await loginAgent(user.email, user.password);

      const res = await agent.get("/api/users/me");

      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty("ticketBalance");
      expect(res.body.data).not.toHaveProperty("ticketCount");
      expect(res.body.data).not.toHaveProperty("tickets");
    });

    it("[5-2] 이벤트 상세·목록에 entryFeeTickets 없음", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const detail = await request(app).get(`/api/events/${eventId}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data).not.toHaveProperty("entryFeeTickets");

      const list = await request(app).get("/api/events");
      expect(list.status).toBe(200);
      for (const ev of list.body.data) {
        expect(ev).not.toHaveProperty("entryFeeTickets");
      }
    });

    it("[5-3] 이벤트 통계에 netRevenue 없음", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const res = await adminAgent.get(`/api/admin/events/${eventId}/stats`);

      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty("netRevenue");
      expect(typeof res.body.data.registered).toBe("number");
      expect(typeof res.body.data.ticketed).toBe("number");
      expect(typeof res.body.data.noShow).toBe("number");
    });
  });

  // ─── [6] Mass Assignment ──────────────────────────────────────────────────────

  describe("[6] 관리자 생성·수정에서 entryFeeTickets 무시", () => {
    it("[6-1] POST /api/admin/events 에 entryFeeTickets 를 넣어도 201 + 응답에 반영 안 됨", async () => {
      const res = await adminAgent
        .post("/api/admin/events")
        .set("Content-Type", "application/json")
        .send({
          title:       "__tev_no_fee",
          category:    "concert",
          venueId:     DEFAULT_VENUE_SLUG,
          opensAt:     futureISO(20),
          prize:       "test prize",
          posterColor: "#AABBCC",
          entryFeeTickets: 9999,
        });

      expect(res.status).toBe(201);
      expect(res.body.data).not.toHaveProperty("entryFeeTickets");
      createdEventIds.push(res.body.data.eventId);
    });

    it("[6-2] PATCH /api/admin/events/:eventId 에 entryFeeTickets 를 넣어도 다른 필드만 반영", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const res = await adminAgent
        .patch(`/api/admin/events/${eventId}`)
        .set("Content-Type", "application/json")
        .send({ prize: "__tev_updated_prize", entryFeeTickets: 9999 });

      expect(res.status).toBe(200);
      expect(res.body.data.prize).toBe("__tev_updated_prize");
      expect(res.body.data).not.toHaveProperty("entryFeeTickets");
    });
  });
});
