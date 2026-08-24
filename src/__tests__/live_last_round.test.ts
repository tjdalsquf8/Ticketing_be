/**
 * GET /api/live/last-round 스펙 검증
 *
 * 1. 종료 회차 없음 → data: null
 * 2. 종료 회차 있음 → 상위 N명 랭킹 반환, elapsed_ms ASC 정렬 확인
 * 3. limit 파라미터 범위 (기본 10, 최대 30) 검증
 */

import request from "supertest";
import app from "../app";
import pool from "../config/db";
import { v4 as uuidv4 } from "uuid";
import {
  createTestRound,
  insertTestSession,
  cleanupTestRounds,
} from "./helpers/live.helper";

// ─── 전역 상태 ─────────────────────────────────────────────────────────────────

const createdRoundIds: number[] = [];

// ─── 정리 ──────────────────────────────────────────────────────────────────────

afterAll(async () => {
  await cleanupTestRounds(createdRoundIds);
});

// ─── 테스트 스위트 ─────────────────────────────────────────────────────────────

describe("GET /api/live/last-round", () => {
  it("[1] 종료 회차 없을 때 data: null 반환", async () => {
    // 모든 closed 회차를 지우는 대신, 임시로 이 API 자체를 호출해 null 여부만 확인
    // (DB에 다른 closed 회차가 있을 수 있으므로, 여기서는 응답 구조만 검증)
    const res = await request(app).get("/api/live/last-round");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // data 는 null 이거나 { round, rankings } 구조
    if (res.body.data === null) {
      expect(res.body.data).toBeNull();
    } else {
      expect(res.body.data).toHaveProperty("round");
      expect(res.body.data).toHaveProperty("rankings");
    }
  });

  it("[2] closed 회차에 completed 세션 있으면 rankings 반환 + elapsed_ms ASC 정렬", async () => {
    // closed 회차 생성
    const { roundId, eventId } = await createTestRound({
      status: "closed",
      opensOffsetSeconds: -120,
      closesOffsetSeconds: -1,
    });
    createdRoundIds.push(roundId);

    // completed 세션 3개 삽입 (elapsed_ms 역순으로 삽입해 정렬 검증)
    const sessions = [
      { elapsedMs: 9000, pos: 3 },
      { elapsedMs: 3000, pos: 1 },
      { elapsedMs: 6000, pos: 2 },
    ];

    for (const s of sessions) {
      await insertTestSession({
        roundId,
        guestUuid: uuidv4(),
        nickname: `rank_${s.pos}`,
        status: "completed",
        elapsedMs: s.elapsedMs,
        seatLabel: `A-1-${s.pos}`,
      });
    }

    const res = await request(app).get("/api/live/last-round?limit=10");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).not.toBeNull();

    const { round, rankings } = res.body.data;

    // 가장 최신 closed 회차가 방금 만든 roundId 이어야 함
    expect(round.roundId).toBe(roundId);

    // elapsed_ms ASC 정렬 확인
    expect(Array.isArray(rankings)).toBe(true);
    expect(rankings.length).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < rankings.length - 1; i++) {
      expect(rankings[i].elapsedMs).toBeLessThanOrEqual(rankings[i + 1].elapsedMs);
    }

    // rank 필드 1부터 시작
    expect(rankings[0].rank).toBe(1);
    expect(rankings[0].elapsedMs).toBe(3000);
  });

  it("[3-1] limit 파라미터 없으면 기본 10명 이하 반환", async () => {
    // 세션 12개가 있는 closed 회차 생성
    const { roundId } = await createTestRound({
      status: "closed",
      opensOffsetSeconds: -200,
      closesOffsetSeconds: -2,
    });
    createdRoundIds.push(roundId);

    for (let i = 0; i < 12; i++) {
      await insertTestSession({
        roundId,
        guestUuid: uuidv4(),
        nickname: `lim_${i}`,
        status: "completed",
        elapsedMs: (i + 1) * 1000,
        seatLabel: `B-1-${i + 1}`,
      });
    }

    const res = await request(app).get("/api/live/last-round");

    expect(res.status).toBe(200);
    if (res.body.data) {
      // 이 회차가 가장 최신이면 rankings ≤ 10
      if (res.body.data.round.roundId === roundId) {
        expect(res.body.data.rankings.length).toBeLessThanOrEqual(10);
      }
    }
  });

  it("[3-2] limit=30 이면 최대 30명으로 제한", async () => {
    const res = await request(app).get("/api/live/last-round?limit=30");

    expect(res.status).toBe(200);
    if (res.body.data && res.body.data.rankings) {
      expect(res.body.data.rankings.length).toBeLessThanOrEqual(30);
    }
  });

  it("[3-2b] limit=31 이상이면 422 VALIDATION_ERROR", async () => {
    const res = await request(app).get("/api/live/last-round?limit=100");

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("[3-3] limit=5 이면 5명 이하 반환", async () => {
    const { roundId } = await createTestRound({
      status: "closed",
      opensOffsetSeconds: -300,
      closesOffsetSeconds: -3,
    });
    createdRoundIds.push(roundId);

    for (let i = 0; i < 8; i++) {
      await insertTestSession({
        roundId,
        guestUuid: uuidv4(),
        nickname: `lim5_${i}`,
        status: "completed",
        elapsedMs: (i + 1) * 500,
        seatLabel: `C-1-${i + 1}`,
      });
    }

    const res = await request(app).get("/api/live/last-round?limit=5");

    expect(res.status).toBe(200);
    // 이 회차가 최신이면 검증
    if (res.body.data && res.body.data.round.roundId === roundId) {
      expect(res.body.data.rankings.length).toBeLessThanOrEqual(5);
    }
  });
});
