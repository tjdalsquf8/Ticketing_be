/**
 * 티켓 조회 API 통합 테스트
 *
 * 테스트 대상:
 *   GET /api/tickets/me
 *   GET /api/tickets/:ticketId
 */

import crypto from "crypto";
import request from "supertest";
import app from "../app";
import pool from "../config/db";
import { v4 as uuidv4 } from "uuid";
import {
  createTestUser,
  createTestRound,
  insertTestSession,
  cleanupTestRounds,
  cleanupTestLiveUsers,
} from "./helpers/live.helper";

// ─── 전역 상태 ─────────────────────────────────────────────────────────────────

const createdRoundIds: number[] = [];

/** 로그인 후 accessToken 쿠키를 보유한 supertest agent 반환 */
async function loginAgent(email: string, password: string) {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/login")
    .set("Content-Type", "application/json")
    .send({ email, password });
  return agent;
}

/** 티켓 직접 삽입 헬퍼 (라이브 라운드 티켓: event_id=NULL) */
async function insertTestTicket(opts: {
  userId: number;
  roundId: number;
  sessionDbId: number;
  seatLabel?: string;
  rank?: number;
  elapsedMs?: number;
}): Promise<number> {
  const {
    userId,
    roundId,
    sessionDbId,
    seatLabel = "A-1-1",
    rank = 1,
    elapsedMs = 5000,
  } = opts;

  const serial = crypto.randomUUID().replace(/-/g, "").substring(0, 12).toUpperCase();

  const insRes = await pool.query(
    `INSERT INTO tickets
       (live_session_id, user_id, round_id, event_id, passenger_nickname,
        serial, seat_label, elapsed_ms, rank, total_participants)
     VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, 0)
     RETURNING id`,
    [sessionDbId, userId, roundId, "test_nick", serial, seatLabel, elapsedMs, rank],
  );
  const ticketId: number = insRes.rows[0].id;

  return ticketId;
}

// ─── 정리 ──────────────────────────────────────────────────────────────────────

afterAll(async () => {
  await cleanupTestRounds(createdRoundIds);
  await cleanupTestLiveUsers();
});

// ─── 테스트 스위트 ─────────────────────────────────────────────────────────────

describe("Tickets API", () => {
  // ─── [1] GET /api/tickets/me ──────────────────────────────────────────────

  describe("[1] GET /api/tickets/me", () => {
    it("[1-1] 인증 없이 → 401", async () => {
      const res = await request(app).get("/api/tickets/me");
      expect(res.status).toBe(401);
    });

    it("[1-2] 본인 티켓 목록 + 페이지네이션 필드 확인", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const { userId, email, password } = await createTestUser();
      const agent = await loginAgent(email, password);

      // 세션 2개 + 티켓 2개 삽입
      // 같은 userId로 두 개의 completed 세션 삽입
      // partial unique index (round_id, user_id) WHERE status IN (queued/active/completed)
      // → completed 도 인덱스 대상이므로 별도 라운드에 삽입
      const { roundId: roundId2 } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId2);

      const { sessionDbId: sid1 } = await insertTestSession({
        roundId,
        userId,
        nickname: "buyer1",
        status: "completed",
        seatLabel: "A-1-1",
        elapsedMs: 3000,
      });
      const { sessionDbId: sid2 } = await insertTestSession({
        roundId: roundId2,
        userId,
        nickname: "buyer2",
        status: "completed",
        seatLabel: "A-1-2",
        elapsedMs: 4000,
      });

      await insertTestTicket({ userId, roundId, sessionDbId: sid1, seatLabel: "A-1-1", rank: 1 });
      await insertTestTicket({ userId, roundId: roundId2, sessionDbId: sid2, seatLabel: "A-1-2", rank: 1 });

      const res = await agent.get("/api/tickets/me?page=1&limit=10");

      // 응답 구조: { success: true, data: items[], meta: { page, size, totalCount } }
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      expect(res.body.meta.totalCount).toBeGreaterThanOrEqual(2);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.size).toBe(10);

      const item = res.body.data[0];
      expect(item).toHaveProperty("ticketId");
      expect(item).toHaveProperty("serial");
      expect(item).toHaveProperty("seatLabel");
      expect(item).toHaveProperty("rankNumber");
      expect(item).toHaveProperty("elapsedMs");
      expect(item).toHaveProperty("issuedAt");
    });
  });

  // ─── [2] GET /api/tickets/:ticketId ──────────────────────────────────────

  describe("[2] GET /api/tickets/:ticketId", () => {
    it("[2-1] 본인 티켓 상세 반환", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const { userId, email, password } = await createTestUser();
      const agent = await loginAgent(email, password);

      const { sessionDbId } = await insertTestSession({
        roundId,
        userId,
        nickname: "detail_buyer",
        status: "completed",
        seatLabel: "A-1-1",
        elapsedMs: 5000,
      });
      const ticketId = await insertTestTicket({ userId, roundId, sessionDbId, seatLabel: "A-1-1" });

      const res = await agent.get(`/api/tickets/${ticketId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ticketId).toBe(ticketId);
      expect(res.body.data.serial).toBeDefined();
      expect(res.body.data.seatLabel).toBe("A-1-1");
      expect(res.body.data).not.toHaveProperty("qrPayload");
      // rankPercentile: totalParticipants=0 이면 null, 그렇지 않으면 number
      expect(
        res.body.data.rankPercentile === null ||
        typeof res.body.data.rankPercentile === "number"
      ).toBe(true);
    });

    it("[2-2] 다른 사용자 티켓 조회 → 403 TICKET_FORBIDDEN", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      // 소유자
      const { userId: ownerUserId } = await createTestUser();
      const { sessionDbId } = await insertTestSession({
        roundId,
        userId: ownerUserId,
        nickname: "owner",
        status: "completed",
        seatLabel: "A-1-1",
        elapsedMs: 5000,
      });
      const ticketId = await insertTestTicket({
        userId: ownerUserId,
        roundId,
        sessionDbId,
      });

      // 다른 사용자로 조회
      const { email: otherEmail, password: otherPass } = await createTestUser();
      const otherAgent = await loginAgent(otherEmail, otherPass);

      const res = await otherAgent.get(`/api/tickets/${ticketId}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("TICKET_FORBIDDEN");
    });

    it("[2-3] 없는 ticketId → 404 TICKET_NOT_FOUND", async () => {
      const { email, password } = await createTestUser();
      const agent = await loginAgent(email, password);

      const res = await agent.get("/api/tickets/99999999");

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
    });
  });
});
