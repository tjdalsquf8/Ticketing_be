/**
 * GET /api/admin/live/rounds/:roundId/stats 통합 테스트
 *
 * [1] 정상 조회 (200, 필드 모두 존재)
 * [2] 존재하지 않는 roundId → 404 ROUND_NOT_FOUND
 * [3] 비관리자 접근 → 403
 * [4] 비인증 접근 → 401
 */

import request from "supertest";
import app from "../app";
import pool from "../config/db";
import {
  createTestRound,
  cleanupTestRounds,
  insertTestSession,
  createTestUser,
  cleanupTestLiveUsers,
} from "./helpers/live.helper";
import {
  createAdminUser,
  createTestUserWithTickets,
  cleanupTestEvUsers,
  type TestUserResult,
} from "./helpers/events.helper";

// ─── 전역 상태 ─────────────────────────────────────────────────────────────────

let admin: TestUserResult;
let adminAgent: ReturnType<typeof request.agent>;
let normalAgent: ReturnType<typeof request.agent>;

const createdRoundIds: number[] = [];

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

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
  await cleanupTestLiveUsers();

  admin = await createAdminUser();
  const normal = await createTestUserWithTickets(0);

  adminAgent  = await loginAgent(admin.email, admin.password);
  normalAgent = await loginAgent(normal.email, normal.password);
});

afterAll(async () => {
  await cleanupTestRounds(createdRoundIds);
  await cleanupTestLiveUsers();
  await cleanupTestEvUsers();
  await pool.end();
});

// ─── 테스트 스위트 ─────────────────────────────────────────────────────────────

describe("GET /api/admin/live/rounds/:roundId/stats", () => {

  // ─── [1] 정상 조회 ────────────────────────────────────────────────────────────

  it("[1] 정상 조회 — 200, 필드 모두 존재, 타입 검증", async () => {
    // closed 라운드 생성 후 세션 직접 삽입
    const { roundId } = await createTestRound({
      status: "closed",
      opensOffsetSeconds: -400,
      closesOffsetSeconds: -100,
    });
    createdRoundIds.push(roundId);

    // 테스트 사용자 2명 생성 후 세션 삽입
    const userA = await createTestUser();
    const userB = await createTestUser();

    // A: completed (좌석 확정 성공)
    await insertTestSession({
      roundId,
      userId: userA.userId,
      status: "completed",
      elapsedMs: 5000,
      seatLabel: "A-1-1",
    });

    // B: active (좌석 못 잡음 — noShow)
    await insertTestSession({
      roundId,
      userId: userB.userId,
      status: "active",
    });

    const res = await adminAgent.get(
      `/api/admin/live/rounds/${roundId}/stats`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data.roundId).toBe(roundId);
    expect(typeof data.status).toBe("string");
    expect(data.status).toBe("closed");

    // registered: 세션 수 = 2
    expect(data.registered).toBe(2);

    // completed: 완주 세션 수 (userA 만 completed)
    expect(data.completed).toBe(1);

    // noShow: completed 아닌 세션 = 1 (userB)
    expect(data.noShow).toBe(1);

    // netRevenue: 라이브는 항상 0
    expect(data.netRevenue).toBe(0);

    // 타입 검증
    expect(typeof data.registered).toBe("number");
    expect(typeof data.completed).toBe("number");
    expect(typeof data.noShow).toBe("number");
    expect(typeof data.netRevenue).toBe("number");
  });

  // ─── [1-2] 세션 없는 라운드 → 0 값 ────────────────────────────────────────────

  it("[1-2] 세션이 없는 라운드 → registered/completed/noShow 모두 0", async () => {
    const { roundId } = await createTestRound({
      status: "closed",
      opensOffsetSeconds: -400,
      closesOffsetSeconds: -100,
    });
    createdRoundIds.push(roundId);

    const res = await adminAgent.get(
      `/api/admin/live/rounds/${roundId}/stats`,
    );

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.registered).toBe(0);
    expect(data.completed).toBe(0);
    expect(data.noShow).toBe(0);
    expect(data.netRevenue).toBe(0);
  });

  // ─── [2] 존재하지 않는 roundId → 404 ─────────────────────────────────────────

  it("[2] 존재하지 않는 roundId → 404 ROUND_NOT_FOUND", async () => {
    const res = await adminAgent.get("/api/admin/live/rounds/99999999/stats");

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("ROUND_NOT_FOUND");
  });

  // ─── [3] 비관리자 접근 → 403 ──────────────────────────────────────────────────

  it("[3] 비관리자 접근 → 403", async () => {
    const { roundId } = await createTestRound({ status: "closed" });
    createdRoundIds.push(roundId);

    const res = await normalAgent.get(
      `/api/admin/live/rounds/${roundId}/stats`,
    );

    expect(res.status).toBe(403);
  });

  // ─── [4] 비인증 접근 → 401 ────────────────────────────────────────────────────

  it("[4] 비인증 접근 → 401", async () => {
    const { roundId } = await createTestRound({ status: "closed" });
    createdRoundIds.push(roundId);

    const res = await request(app).get(
      `/api/admin/live/rounds/${roundId}/stats`,
    );

    expect(res.status).toBe(401);
  });
});
