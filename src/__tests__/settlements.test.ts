/**
 * 정산 이력(기프티콘) API 통합 테스트
 *
 * GET  /api/admin/settlements/gifticons
 * POST /api/admin/settlements/gifticons/:id/issue
 */

import crypto from "crypto";
import request from "supertest";
import app from "../app";
import pool from "../config/db";
import {
  createAdminUser,
  createTestUserWithPoints,
  createTestEvent,
  cleanupTestEvents,
  cleanupTestEvUsers,
  type TestUserResult,
} from "./helpers/events.helper";

// ─── 전역 상태 ─────────────────────────────────────────────────────────────────

let admin: TestUserResult;
let adminAgent: ReturnType<typeof request.agent>;
let normalUser: TestUserResult;
let normalAgent: ReturnType<typeof request.agent>;

const createdEventIds: number[] = [];
const createdGifticonIds: number[] = [];

async function loginAgent(email: string, password: string) {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/login")
    .set("Content-Type", "application/json")
    .send({ email, password });
  return agent;
}

/** 유료 이벤트 참가 티켓 직접 삽입 (live_sessions + tickets, event_id 기준) */
async function insertEventTicket(opts: {
  userId: number;
  eventId: number;
  rank: number;
  elapsedMs?: number;
}): Promise<number> {
  const { userId, eventId, rank, elapsedMs = 5000 } = opts;
  const sessionId = crypto.randomBytes(8).toString("hex");

  const sessionRes = await pool.query(
    `INSERT INTO live_sessions
       (session_id, user_id, nickname, status, elapsed_ms, completed_at, event_id)
     VALUES ($1, $2, 'test_nick', 'completed', $3, NOW(), $4)
     RETURNING id`,
    [sessionId, userId, elapsedMs, eventId],
  );
  const sessionDbId: number = sessionRes.rows[0].id;

  const serial = crypto.randomUUID().replace(/-/g, "").substring(0, 12).toUpperCase();
  const ticketRes = await pool.query(
    `INSERT INTO tickets
       (live_session_id, user_id, round_id, event_id, passenger_nickname,
        serial, seat_label, elapsed_ms, rank, total_participants)
     VALUES ($1, $2, NULL, $3, 'test_nick', $4, 'A-1-1', $5, $6, 0)
     RETURNING id`,
    [sessionDbId, userId, eventId, serial, elapsedMs, rank],
  );
  return ticketRes.rows[0].id;
}

/** 테스트용 기프티콘 재고 직접 삽입 */
async function insertGifticon(opts: {
  createdBy: number;
  status?: "available" | "issued";
  faceValue?: number;
}): Promise<number> {
  const { createdBy, status = "available", faceValue = 4500 } = opts;
  const code = crypto.randomBytes(6).toString("hex");
  const res = await pool.query(
    `INSERT INTO gifticons (category, product_name, face_value, code, status, created_by)
     VALUES ('coffee', '__test_settlement_product', $1, $2, $3, $4)
     RETURNING id`,
    [faceValue, code, status, createdBy],
  );
  return res.rows[0].id;
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await cleanupTestEvUsers();
  admin = await createAdminUser();
  normalUser = await createTestUserWithPoints(10000);
  adminAgent = await loginAgent(admin.email, admin.password);
  normalAgent = await loginAgent(normalUser.email, normalUser.password);
});

afterAll(async () => {
  await cleanupTestEvents(createdEventIds);
  if (createdGifticonIds.length > 0) {
    await pool.query(`DELETE FROM gifticons WHERE id = ANY($1::int[])`, [createdGifticonIds]);
  }
  await cleanupTestEvUsers();
});

// ─── 테스트 스위트 ─────────────────────────────────────────────────────────────

describe("Settlements (Gifticons) API", () => {
  describe("[1] GET /api/admin/settlements/gifticons", () => {
    it("[1-1] 인증 없이 → 401", async () => {
      const res = await request(app).get("/api/admin/settlements/gifticons");
      expect(res.status).toBe(401);
    });

    it("[1-2] 관리자 아님 → 403", async () => {
      const res = await normalAgent.get("/api/admin/settlements/gifticons");
      expect(res.status).toBe(403);
    });

    it("[1-3] TOP3 당첨자만 pending 상태로 반환, rank 4위는 제외", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const t1 = await insertEventTicket({ userId: normalUser.userId, eventId, rank: 1 });
      await insertEventTicket({ userId: normalUser.userId, eventId, rank: 4 });

      const res = await adminAgent.get(
        `/api/admin/settlements/gifticons?eventId=${eventId}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      const row = res.body.data[0];
      expect(row.id).toBe(`st-${t1}`);
      expect(row.eventId).toBe(eventId);
      expect(row.rank).toBe(1);
      expect(row.status).toBe("pending");
      expect(row.gifticonId).toBeNull();
      expect(row.userId).toBe(normalUser.userId);
    });

    it("[1-4] status=issued 필터 시 pending row는 제외된다", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);
      await insertEventTicket({ userId: normalUser.userId, eventId, rank: 1 });

      const res = await adminAgent.get(
        `/api/admin/settlements/gifticons?eventId=${eventId}&status=issued`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe("[2] POST /api/admin/settlements/gifticons/:id/issue", () => {
    it("[2-1] pending row에 available 재고 배정 → issued 전환", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);
      const ticketId = await insertEventTicket({ userId: normalUser.userId, eventId, rank: 1 });
      const gifticonId = await insertGifticon({ createdBy: admin.userId });
      createdGifticonIds.push(gifticonId);

      const res = await adminAgent
        .post(`/api/admin/settlements/gifticons/st-${ticketId}/issue`)
        .set("Content-Type", "application/json")
        .send({ gifticonId });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("issued");
      expect(res.body.data.gifticonId).toBe(gifticonId);
      expect(res.body.data.issuedAt).not.toBeNull();

      const gifticonRow = await pool.query(`SELECT status FROM gifticons WHERE id = $1`, [
        gifticonId,
      ]);
      expect(gifticonRow.rows[0].status).toBe("issued");
    });

    it("[2-2] 이미 issued인 row 재요청 → 409", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);
      const ticketId = await insertEventTicket({ userId: normalUser.userId, eventId, rank: 1 });
      const gifticonId1 = await insertGifticon({ createdBy: admin.userId });
      const gifticonId2 = await insertGifticon({ createdBy: admin.userId });
      createdGifticonIds.push(gifticonId1, gifticonId2);

      await adminAgent
        .post(`/api/admin/settlements/gifticons/st-${ticketId}/issue`)
        .set("Content-Type", "application/json")
        .send({ gifticonId: gifticonId1 });

      const res = await adminAgent
        .post(`/api/admin/settlements/gifticons/st-${ticketId}/issue`)
        .set("Content-Type", "application/json")
        .send({ gifticonId: gifticonId2 });

      expect(res.status).toBe(409);
    });

    it("[2-3] available 아닌 재고 지정 → 409", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);
      const ticketId = await insertEventTicket({ userId: normalUser.userId, eventId, rank: 2 });
      const gifticonId = await insertGifticon({ createdBy: admin.userId, status: "issued" });
      createdGifticonIds.push(gifticonId);

      const res = await adminAgent
        .post(`/api/admin/settlements/gifticons/st-${ticketId}/issue`)
        .set("Content-Type", "application/json")
        .send({ gifticonId });

      expect(res.status).toBe(409);
    });

    it("[2-4] TOP3가 아닌 티켓(rank 4)은 정산 대상 아님 → 404", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);
      const ticketId = await insertEventTicket({ userId: normalUser.userId, eventId, rank: 4 });
      const gifticonId = await insertGifticon({ createdBy: admin.userId });
      createdGifticonIds.push(gifticonId);

      const res = await adminAgent
        .post(`/api/admin/settlements/gifticons/st-${ticketId}/issue`)
        .set("Content-Type", "application/json")
        .send({ gifticonId });

      expect(res.status).toBe(404);
    });
  });
});
