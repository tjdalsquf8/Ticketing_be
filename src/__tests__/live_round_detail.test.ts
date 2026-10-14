/**
 * GET /api/live/rounds/:roundId 통합 테스트
 *
 * 1. 존재하는 회차 → 200, 필드 검증
 * 2. 없는 회차 → 404 ROUND_NOT_FOUND
 * 3. roundId 형식 오류 (문자열) → 422 VALIDATION_ERROR
 * 4. myParticipation — 요청자 기준 참여 여부
 */

import request from "supertest";
import app from "../app";
import pool from "../config/db";
import {
  createTestRound,
  cleanupTestRounds,
  createTestUser,
  cleanupTestLiveUsers,
  insertTestSession,
} from "./helpers/live.helper";

// ─── 전역 상태 ─────────────────────────────────────────────────────────────────

const createdRoundIds: number[] = [];

// ─── 정리 ──────────────────────────────────────────────────────────────────────

afterAll(async () => {
  await cleanupTestRounds(createdRoundIds);
  await cleanupTestLiveUsers();
  await pool.end();
});

async function loginAgent(email: string, password: string) {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/login")
    .set("Content-Type", "application/json")
    .send({ email, password });
  return agent;
}

// ─── 테스트 스위트 ─────────────────────────────────────────────────────────────

describe("GET /api/live/rounds/:roundId", () => {
  it("[1] 존재하는 회차 → 200, 필드 검증", async () => {
    const { roundId, seatLabels } = await createTestRound({ status: "open" });
    createdRoundIds.push(roundId);

    const res = await request(app).get(`/api/live/rounds/${roundId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data.roundId).toBe(roundId);
    expect(data.status).toBe("open");
    expect(typeof data.opensAt).toBe("string");
    expect(typeof data.closesAt).toBe("string");
    expect(data.totalSeats).toBe(seatLabels.length);
  });

  it("[2] 없는 회차 → 404 ROUND_NOT_FOUND", async () => {
    const res = await request(app).get("/api/live/rounds/99999999");

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("ROUND_NOT_FOUND");
  });

  it("[3] roundId 형식 오류 (문자열) → 422 VALIDATION_ERROR", async () => {
    const res = await request(app).get("/api/live/rounds/abc");

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  // ─── myParticipation ─────────────────────────────────────────────────────────

  describe("[4] myParticipation", () => {
    it("[4-1] 비로그인·쿠키 없음 → null", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const res = await request(app).get(`/api/live/rounds/${roundId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.myParticipation).toBeNull();
    });

    it("[4-2] 참여 이력 없는 로그인 유저 → null", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);
      const user = await createTestUser();
      const agent = await loginAgent(user.email, user.password);

      const res = await agent.get(`/api/live/rounds/${roundId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.myParticipation).toBeNull();
    });

    it("[4-3] 완주한 로그인 유저 → completed + 좌석·기록 포함", async () => {
      const { roundId } = await createTestRound({ status: "closed" });
      createdRoundIds.push(roundId);
      const user = await createTestUser();
      const { sessionId } = await insertTestSession({
        roundId,
        userId: user.userId,
        nickname: user.name,
        status: "completed",
        seatLabel: "A-1-1",
        elapsedMs: 3200,
      });

      const agent = await loginAgent(user.email, user.password);
      const res = await agent.get(`/api/live/rounds/${roundId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.myParticipation).toEqual({
        sessionId,
        status: "completed",
        queuePosition: null,
        seatLabel: "A-1-1",
        elapsedMs: 3200,
      });
    });

    it("[4-4] 다른 사람의 세션은 내 참여로 잡히지 않는다", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);
      const owner = await createTestUser();
      const other = await createTestUser();
      await insertTestSession({
        roundId,
        userId: owner.userId,
        nickname: owner.name,
        status: "active",
      });

      const agent = await loginAgent(other.email, other.password);
      const res = await agent.get(`/api/live/rounds/${roundId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.myParticipation).toBeNull();
    });

    it("[4-5] 게스트는 guest_uuid 쿠키로 식별된다", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const agent = request.agent(app);
      // guest_uuid httpOnly 쿠키 발급
      const guestRes = await agent.post("/api/guests").send({});
      const guestUuid = guestRes.body.data.guestUuid;

      await insertTestSession({
        roundId,
        guestUuid,
        nickname: "__tlv_guest_part",
        status: "queued",
        queuePosition: 3,
      });

      const res = await agent.get(`/api/live/rounds/${roundId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.myParticipation.status).toBe("queued");
      expect(res.body.data.myParticipation.queuePosition).toBe(3);
    });
  });
});
