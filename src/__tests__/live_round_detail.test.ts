/**
 * GET /api/live/rounds/:roundId 통합 테스트
 *
 * 1. 존재하는 회차 → 200, 필드 검증
 * 2. 없는 회차 → 404 ROUND_NOT_FOUND
 * 3. roundId 형식 오류 (문자열) → 422 VALIDATION_ERROR
 */

import request from "supertest";
import app from "../app";
import {
  createTestRound,
  cleanupTestRounds,
} from "./helpers/live.helper";

// ─── 전역 상태 ─────────────────────────────────────────────────────────────────

const createdRoundIds: number[] = [];

// ─── 정리 ──────────────────────────────────────────────────────────────────────

afterAll(async () => {
  await cleanupTestRounds(createdRoundIds);
});

// ─── 테스트 스위트 ─────────────────────────────────────────────────────────────

describe("GET /api/live/rounds/:roundId", () => {
  it("[1] 존재하는 회차 → 200, 필드 검증", async () => {
    const { roundId, eventId, seatLabels } = await createTestRound({ status: "open" });
    createdRoundIds.push(roundId);

    const res = await request(app).get(`/api/live/rounds/${roundId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data.roundId).toBe(roundId);
    expect(data.eventId).toBe(eventId);
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
});
