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
  createTestUserWithTickets,
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

/**
 * 유료 이벤트 완주 세션 직접 삽입.
 *
 * TOP3 판정이 tickets.rank 가 아니라 live_sessions.elapsed_ms 정렬로 바뀌었으므로,
 * 등수는 elapsedMs 의 상대적 크기로 결정된다 (작을수록 상위).
 * 반환값은 정산 id(`st-{n}`)에 쓰이는 live_sessions.id.
 */
async function insertEventFinisher(opts: {
  userId: number;
  eventId: number;
  elapsedMs: number;
}): Promise<number> {
  const { userId, eventId, elapsedMs } = opts;
  const sessionId = crypto.randomBytes(8).toString("hex");

  const sessionRes = await pool.query(
    `INSERT INTO live_sessions
       (session_id, user_id, nickname, status, elapsed_ms, completed_at, event_id)
     VALUES ($1, $2, 'test_nick', 'completed', $3, NOW(), $4)
     RETURNING id`,
    [sessionId, userId, elapsedMs, eventId],
  );
  return sessionRes.rows[0].id;
}

/**
 * 정산 대상이 되려면 이벤트가 closed 여야 한다.
 * 진행 중 이벤트는 순위가 계속 바뀌므로 CTE 에서 제외된다.
 */
async function createClosedEvent(): Promise<number> {
  const { eventId } = await createTestEvent(
    { status: "closed", opensAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    admin.userId,
  );
  createdEventIds.push(eventId);
  return eventId;
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
  normalUser = await createTestUserWithTickets(10000);
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

    it("[1-3] 빠른 순 TOP3만 pending 으로 반환, 4위는 제외", async () => {
      const eventId = await createClosedEvent();

      const first  = await insertEventFinisher({ userId: normalUser.userId, eventId, elapsedMs: 1000 });
      const u2 = await createTestUserWithTickets(0);
      const u3 = await createTestUserWithTickets(0);
      const u4 = await createTestUserWithTickets(0);
      await insertEventFinisher({ userId: u2.userId, eventId, elapsedMs: 2000 });
      await insertEventFinisher({ userId: u3.userId, eventId, elapsedMs: 3000 });
      const fourth = await insertEventFinisher({ userId: u4.userId, eventId, elapsedMs: 4000 });

      const res = await adminAgent.get(
        `/api/admin/settlements/gifticons?eventId=${eventId}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);

      const ids = res.body.data.map((r: { id: string }) => r.id);
      expect(ids).toContain(`st-${first}`);
      expect(ids).not.toContain(`st-${fourth}`);

      const top = res.body.data.find((r: { id: string }) => r.id === `st-${first}`);
      expect(top.rank).toBe(1);
      expect(top.eventId).toBe(eventId);
      expect(top.status).toBe("pending");
      expect(top.gifticonId).toBeNull();
      expect(top.userId).toBe(normalUser.userId);
    });

    it("[1-4] status=issued 필터 시 pending row는 제외된다", async () => {
      const eventId = await createClosedEvent();
      await insertEventFinisher({ userId: normalUser.userId, eventId, elapsedMs: 1000 });

      const res = await adminAgent.get(
        `/api/admin/settlements/gifticons?eventId=${eventId}&status=issued`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it("[1-5] 아직 종료되지 않은 이벤트는 정산 대상이 아니다", async () => {
      const { eventId } = await createTestEvent(
        { status: "open", opensAt: new Date(Date.now() - 10 * 60 * 1000) },
        admin.userId,
      );
      createdEventIds.push(eventId);
      await insertEventFinisher({ userId: normalUser.userId, eventId, elapsedMs: 1000 });

      const res = await adminAgent.get(
        `/api/admin/settlements/gifticons?eventId=${eventId}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it("[1-6] 동점자가 있어도 이벤트당 정확히 3명만 반환한다", async () => {
      const eventId = await createClosedEvent();

      await insertEventFinisher({ userId: normalUser.userId, eventId, elapsedMs: 5000 });
      for (let i = 0; i < 3; i++) {
        const u = await createTestUserWithTickets(0);
        await insertEventFinisher({ userId: u.userId, eventId, elapsedMs: 5000 });
      }

      const res = await adminAgent.get(
        `/api/admin/settlements/gifticons?eventId=${eventId}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data.map((r: { rank: number }) => r.rank).sort()).toEqual([1, 2, 3]);
    });
  });

  describe("[2] POST /api/admin/settlements/gifticons/:id/issue", () => {
    it("[2-1] pending row에 available 재고 배정 → issued 전환", async () => {
      const eventId = await createClosedEvent();
      const sessionId = await insertEventFinisher({
        userId: normalUser.userId, eventId, elapsedMs: 1000,
      });
      const gifticonId = await insertGifticon({ createdBy: admin.userId });
      createdGifticonIds.push(gifticonId);

      const res = await adminAgent
        .post(`/api/admin/settlements/gifticons/st-${sessionId}/issue`)
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
      const eventId = await createClosedEvent();
      const sessionId = await insertEventFinisher({
        userId: normalUser.userId, eventId, elapsedMs: 1000,
      });
      const gifticonId1 = await insertGifticon({ createdBy: admin.userId });
      const gifticonId2 = await insertGifticon({ createdBy: admin.userId });
      createdGifticonIds.push(gifticonId1, gifticonId2);

      await adminAgent
        .post(`/api/admin/settlements/gifticons/st-${sessionId}/issue`)
        .set("Content-Type", "application/json")
        .send({ gifticonId: gifticonId1 });

      const res = await adminAgent
        .post(`/api/admin/settlements/gifticons/st-${sessionId}/issue`)
        .set("Content-Type", "application/json")
        .send({ gifticonId: gifticonId2 });

      expect(res.status).toBe(409);
    });

    it("[2-3] available 아닌 재고 지정 → 409", async () => {
      const eventId = await createClosedEvent();
      const sessionId = await insertEventFinisher({
        userId: normalUser.userId, eventId, elapsedMs: 1000,
      });
      const gifticonId = await insertGifticon({ createdBy: admin.userId, status: "issued" });
      createdGifticonIds.push(gifticonId);

      const res = await adminAgent
        .post(`/api/admin/settlements/gifticons/st-${sessionId}/issue`)
        .set("Content-Type", "application/json")
        .send({ gifticonId });

      expect(res.status).toBe(409);
    });

    it("[2-4] TOP3가 아닌 참가자(4위)는 정산 대상 아님 → 404", async () => {
      const eventId = await createClosedEvent();
      await insertEventFinisher({ userId: normalUser.userId, eventId, elapsedMs: 1000 });
      const u2 = await createTestUserWithTickets(0);
      const u3 = await createTestUserWithTickets(0);
      const u4 = await createTestUserWithTickets(0);
      await insertEventFinisher({ userId: u2.userId, eventId, elapsedMs: 2000 });
      await insertEventFinisher({ userId: u3.userId, eventId, elapsedMs: 3000 });
      const fourth = await insertEventFinisher({ userId: u4.userId, eventId, elapsedMs: 4000 });

      const gifticonId = await insertGifticon({ createdBy: admin.userId });
      createdGifticonIds.push(gifticonId);

      const res = await adminAgent
        .post(`/api/admin/settlements/gifticons/st-${fourth}/issue`)
        .set("Content-Type", "application/json")
        .send({ gifticonId });

      expect(res.status).toBe(404);
    });
  });
});
