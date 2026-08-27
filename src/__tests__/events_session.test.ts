/**
 * 이벤트 티켓팅 세션 흐름 통합 테스트
 *
 * POST /api/events/:eventId/sessions
 * GET  /api/events/sessions/:sessionId/queue
 * GET  /api/events/sessions/:sessionId/seats
 * POST /api/events/sessions/:sessionId/hold
 * POST /api/events/sessions/:sessionId/confirm
 */

import request from "supertest";
import app from "../app";
import pool from "../config/db";
import {
  createAdminUser,
  createTestUserWithPoints,
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

/** open 상태 이벤트 생성 헬퍼
 * opensAt은 과거(이미 오픈), durationMs를 길게 설정하여 closesAt이 미래가 되도록 함
 */
async function createOpenEvent(adminUserId: number): Promise<{ eventId: number }> {
  const opensAt = new Date(Date.now() - 10 * 60 * 1000); // 10분 전 오픈
  // durationMs = 2시간 → closesAt = opensAt + 2h = 지금+110분 (충분히 미래)
  const { eventId } = await createTestEvent(
    { status: "open", opensAt, entryFeePoints: 0, durationMs: 2 * 60 * 60 * 1000 },
    adminUserId,
  );
  return { eventId };
}

/** 세션 시작 전 사전 신청 상태 INSERT */
async function registerAndEnter(
  eventId: number,
  userId: number,
): Promise<{ registrationId: number }> {
  return createTestRegistration(eventId, userId, { status: "pending", pointsPaid: 0 });
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

describe("Events Session API (ticketing flow)", () => {

  // ─── [1] POST /api/events/:eventId/sessions ──────────────────────────────────

  describe("[1] POST /api/events/:eventId/sessions — 세션 시작", () => {
    it("[1-1] open 이벤트에서 신청자가 세션 시작 → 201, sessionId 반환", async () => {
      const { eventId } = await createOpenEvent(admin.userId);
      createdEventIds.push(eventId);

      const user  = await createTestUserWithPoints(0);
      await registerAndEnter(eventId, user.userId);

      const agent = await loginAgent(user.email, user.password);
      const res = await agent
        .post(`/api/events/${eventId}/sessions`)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.sessionId).toBe("string");
      expect(res.body.data.sessionId.length).toBeGreaterThan(0);
      expect(["active", "queued"]).toContain(res.body.data.status);
    });

    it("[1-2] 미신청자 세션 시작 → 403 NOT_REGISTERED", async () => {
      const { eventId } = await createOpenEvent(admin.userId);
      createdEventIds.push(eventId);

      const user  = await createTestUserWithPoints(0);
      const agent = await loginAgent(user.email, user.password);

      const res = await agent
        .post(`/api/events/${eventId}/sessions`)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("NOT_REGISTERED");
    });

    it("[1-3] scheduled 상태 이벤트에서 세션 시작 → 409 EVENT_NOT_OPEN", async () => {
      const { eventId } = await createTestEvent({ status: "scheduled" }, admin.userId);
      createdEventIds.push(eventId);

      const user  = await createTestUserWithPoints(0);
      await registerAndEnter(eventId, user.userId);

      const agent = await loginAgent(user.email, user.password);
      const res = await agent
        .post(`/api/events/${eventId}/sessions`)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("EVENT_NOT_OPEN");
    });

    it("[1-4] 인증 없이 세션 시작 → 401", async () => {
      const { eventId } = await createOpenEvent(admin.userId);
      createdEventIds.push(eventId);

      const res = await request(app)
        .post(`/api/events/${eventId}/sessions`)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(401);
    });

    it("[1-5] 사전 신청 → 세션 시작 시 registration status pending → entered 전환", async () => {
      const { eventId } = await createOpenEvent(admin.userId);
      createdEventIds.push(eventId);

      const user  = await createTestUserWithPoints(0);
      const { registrationId } = await registerAndEnter(eventId, user.userId);

      const agent = await loginAgent(user.email, user.password);
      await agent
        .post(`/api/events/${eventId}/sessions`)
        .set("Content-Type", "application/json");

      // pending → entered 확인
      const regRes = await pool.query(
        `SELECT status FROM event_registrations WHERE id = $1`,
        [registrationId],
      );
      expect(regRes.rows[0].status).toBe("entered");
    });

    it("[1-6] 재요청 시 기존 세션 반환 (idempotent)", async () => {
      const { eventId } = await createOpenEvent(admin.userId);
      createdEventIds.push(eventId);

      const user  = await createTestUserWithPoints(0);
      await registerAndEnter(eventId, user.userId);

      const agent = await loginAgent(user.email, user.password);

      const res1 = await agent
        .post(`/api/events/${eventId}/sessions`)
        .set("Content-Type", "application/json");

      const res2 = await agent
        .post(`/api/events/${eventId}/sessions`)
        .set("Content-Type", "application/json");

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.data.sessionId).toBe(res2.body.data.sessionId);
    });
  });

  // ─── [2] GET /api/events/sessions/:sessionId/queue ───────────────────────────

  describe("[2] GET /api/events/sessions/:sessionId/queue — 세션 상태/순번 조회", () => {
    it("[2-1] active 세션 queue 조회 → 200, status 반환", async () => {
      const { eventId } = await createOpenEvent(admin.userId);
      createdEventIds.push(eventId);

      const user  = await createTestUserWithPoints(0);
      await registerAndEnter(eventId, user.userId);

      const agent = await loginAgent(user.email, user.password);
      const createRes = await agent
        .post(`/api/events/${eventId}/sessions`)
        .set("Content-Type", "application/json");

      const { sessionId } = createRes.body.data;

      const res = await agent.get(`/api/events/sessions/${sessionId}/queue`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("status");
    });

    it("[2-2] 존재하지 않는 sessionId(유효 형식) → 404", async () => {
      // 세션 후속 API 는 authMiddleware 로 인증 강제. 인증된 유저가 존재하지 않는
      // sessionId 를 조회하면 서비스 레이어에서 SESSION_NOT_FOUND(404) 반환.
      const user  = await createTestUserWithPoints(0);
      const agent = await loginAgent(user.email, user.password);

      // sessionId 형식 = 20자 소문자 hex
      const res = await agent
        .get("/api/events/sessions/deadbeefdeadbeefdeaf/queue");

      expect(res.status).toBe(404);
    });
  });

  // ─── [3] GET /api/events/sessions/:sessionId/seats ───────────────────────────

  describe("[3] GET /api/events/sessions/:sessionId/seats — 좌석 목록 조회", () => {
    it("[3-1] active 세션 좌석 목록 → 200, seats 배열 반환 (hold 후)", async () => {
      const { eventId } = await createOpenEvent(admin.userId);
      createdEventIds.push(eventId);

      const user  = await createTestUserWithPoints(0);
      await registerAndEnter(eventId, user.userId);

      const agent = await loginAgent(user.email, user.password);
      const createRes = await agent
        .post(`/api/events/${eventId}/sessions`)
        .set("Content-Type", "application/json");

      const { sessionId, status } = createRes.body.data;

      if (status !== "active") {
        // queued면 seats 조회 불가 → 스킵
        return;
      }

      // FE가 라벨 소유 → hold 시 upsert → seats 배열에 나타남
      await agent
        .post(`/api/events/sessions/${sessionId}/hold`)
        .set("Content-Type", "application/json")
        .send({ seatLabel: "FC-1-1" });

      const res = await agent.get(`/api/events/sessions/${sessionId}/seats`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.seats)).toBe(true);
      expect(res.body.data.seats.length).toBeGreaterThan(0);
      expect(res.body.data.seats[0]).toHaveProperty("seatLabel");
      expect(res.body.data.seats[0]).toHaveProperty("status");
    });

    it("[3-2] hold 후 seats 조회 시 3-segment 라벨이 반환된다", async () => {
      const { eventId } = await createOpenEvent(admin.userId);
      createdEventIds.push(eventId);

      const user  = await createTestUserWithPoints(0);
      await registerAndEnter(eventId, user.userId);

      const agent = await loginAgent(user.email, user.password);
      const createRes = await agent
        .post(`/api/events/${eventId}/sessions`)
        .set("Content-Type", "application/json");

      const { sessionId, status } = createRes.body.data;
      if (status !== "active") return;

      // hold → live_seats에 upsert된 뒤 seats 조회
      const testLabel = "FC-1-1";
      await agent
        .post(`/api/events/sessions/${sessionId}/hold`)
        .set("Content-Type", "application/json")
        .send({ seatLabel: testLabel });

      const res = await agent.get(`/api/events/sessions/${sessionId}/seats`);
      expect(res.status).toBe(200);

      const labels = (res.body.data.seats as Array<{ seatLabel: string }>)
        .map((s) => s.seatLabel);

      expect(labels.length).toBeGreaterThan(0);
      // 3-segment 형식 검증
      const PATTERN = /^[A-Za-z0-9가-힣_-]{1,32}(-[A-Za-z0-9가-힣_-]{1,16}){2}$/;
      const allValid = labels.every((l) => PATTERN.test(l));
      expect(allValid).toBe(true);
    });
  });

  // ─── [4] 전체 hold → confirm 흐름 ────────────────────────────────────────────

  describe("[4] hold → confirm 흐름", () => {
    it("[4-1] 신청자 세션 시작 → hold → confirm → ticketed 상태 + ticketId 발급", async () => {
      const { eventId } = await createOpenEvent(admin.userId);
      createdEventIds.push(eventId);

      const user  = await createTestUserWithPoints(0);
      await registerAndEnter(eventId, user.userId);

      const agent = await loginAgent(user.email, user.password);

      // 1. 세션 시작
      const sessionRes = await agent
        .post(`/api/events/${eventId}/sessions`)
        .set("Content-Type", "application/json");

      expect(sessionRes.status).toBe(201);
      const { sessionId, status } = sessionRes.body.data;

      // queued면 hold 불가이므로 active 상태인지 확인
      if (status !== "active") {
        // queued면 active 될 때까지 기다려야 하므로 스킵
        return;
      }

      // 2. FE가 좌석 카탈로그 소유 → 3-segment 라벨 직접 지정
      const chosenLabel = "FC-1-1";

      // 3. hold (live_seats에 없는 라벨 → upsert 후 hold)
      const holdRes = await agent
        .post(`/api/events/sessions/${sessionId}/hold`)
        .set("Content-Type", "application/json")
        .send({ seatLabel: chosenLabel });

      expect(holdRes.status).toBe(200);
      expect(holdRes.body.data.seatLabel).toBe(chosenLabel);
      expect(holdRes.body.data.expiresAt).toBeDefined();

      // 4. confirm
      const confirmRes = await agent
        .post(`/api/events/sessions/${sessionId}/confirm`)
        .set("Content-Type", "application/json")
        .send({ seatLabel: chosenLabel });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.success).toBe(true);
      expect(confirmRes.body.data.rankNumber).toBeGreaterThan(0);
      expect(confirmRes.body.data.elapsedMs).toBeGreaterThanOrEqual(0);

      // 5. ticketId 확인 (상위 ticketRankCutoff 이내면 발급)
      const ticketId = confirmRes.body.data.ticketId as number | null;
      if (ticketId !== null) {
        expect(typeof ticketId).toBe("number");

        // tickets 테이블에 레코드 존재 확인
        const ticketCheck = await pool.query(
          `SELECT user_id FROM tickets WHERE id = $1`,
          [ticketId],
        );
        expect(ticketCheck.rows.length).toBe(1);
        expect(ticketCheck.rows[0].user_id).toBe(user.userId);
      }

      // 6. event_registrations.status → ticketed or entered (ticketId 있으면 ticketed)
      const regCheck = await pool.query(
        `SELECT status, ticket_id
         FROM event_registrations
         WHERE event_id = $1 AND user_id = $2`,
        [eventId, user.userId],
      );
      expect(regCheck.rows.length).toBe(1);
      if (ticketId !== null) {
        expect(regCheck.rows[0].status).toBe("ticketed");
        expect(regCheck.rows[0].ticket_id).toBe(ticketId);
      }
    });

    it("[4-1-1] hold 시 live_seats에 없는 3-segment 라벨 → upsert 후 hold 성공", async () => {
      const { eventId } = await createOpenEvent(admin.userId);
      createdEventIds.push(eventId);

      const user  = await createTestUserWithPoints(0);
      await registerAndEnter(eventId, user.userId);

      const agent = await loginAgent(user.email, user.password);
      const sessionRes = await agent
        .post(`/api/events/${eventId}/sessions`)
        .set("Content-Type", "application/json");

      expect(sessionRes.status).toBe(201);
      const { sessionId, status } = sessionRes.body.data;
      if (status !== "active") return;

      // live_seats에 미리 레코드 없음 — upsert 되어야 함
      const newLabel = "GA-스탠딩L-31";
      const holdRes = await agent
        .post(`/api/events/sessions/${sessionId}/hold`)
        .set("Content-Type", "application/json")
        .send({ seatLabel: newLabel });

      expect(holdRes.status).toBe(200);
      expect(holdRes.body.data.seatLabel).toBe(newLabel);

      // DB에 레코드 생성 확인
      const dbCheck = await pool.query(
        `SELECT seat_label FROM live_seats WHERE event_id = $1 AND seat_label = $2`,
        [eventId, newLabel],
      );
      expect(dbCheck.rows.length).toBe(1);
    });

    it("[4-2] hold 없이 confirm 시도 → 409 HOLD_EXPIRED", async () => {
      const { eventId } = await createOpenEvent(admin.userId);
      createdEventIds.push(eventId);

      const user  = await createTestUserWithPoints(0);
      await registerAndEnter(eventId, user.userId);

      const agent = await loginAgent(user.email, user.password);
      const sessionRes = await agent
        .post(`/api/events/${eventId}/sessions`)
        .set("Content-Type", "application/json");

      expect(sessionRes.status).toBe(201);
      const { sessionId, status } = sessionRes.body.data;
      if (status !== "active") return;

      // hold 없이 3-segment 좌석 confirm 직접 시도
      const confirmRes = await agent
        .post(`/api/events/sessions/${sessionId}/confirm`)
        .set("Content-Type", "application/json")
        .send({ seatLabel: "A-1-1" });

      expect(confirmRes.status).toBe(409);
      expect(confirmRes.body.error.code).toBe("HOLD_EXPIRED");
    });
  });

  // ─── [5] ticketRankCutoff 경계 검증 ──────────────────────────────────────────

  describe("[5] ticketRankCutoff 경계 검증", () => {
    it("[5-1] 첫 번째 confirm 참가자 → rankNumber=1 (ticketId 발급 대상)", async () => {
      const { eventId } = await createOpenEvent(admin.userId);
      createdEventIds.push(eventId);

      const user  = await createTestUserWithPoints(0);
      await registerAndEnter(eventId, user.userId);

      const agent = await loginAgent(user.email, user.password);

      const sessionRes = await agent
        .post(`/api/events/${eventId}/sessions`)
        .set("Content-Type", "application/json");

      const { sessionId, status } = sessionRes.body.data;
      if (status !== "active") return;

      // FE가 좌석 카탈로그 소유 → 3-segment 라벨 직접 지정
      const chosenLabel = "A-1-1";

      await agent
        .post(`/api/events/sessions/${sessionId}/hold`)
        .set("Content-Type", "application/json")
        .send({ seatLabel: chosenLabel });

      const confirmRes = await agent
        .post(`/api/events/sessions/${sessionId}/confirm`)
        .set("Content-Type", "application/json")
        .send({ seatLabel: chosenLabel });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.data.rankNumber).toBe(1);
      // 1번 → ticketId가 있어야 함
      expect(confirmRes.body.data.ticketId).not.toBeNull();
    });
  });
});
