/**
 * GET /api/live/rounds/:roundId/rankings 통합 테스트
 *
 * 1. 완주자 순위 목록 — elapsed_ms ASC, 미완주 세션 제외
 * 2. 동률은 RANK() 로 같은 등수 공유
 * 3. me — 게스트(guest_uuid 쿠키) 기준, 페이지 밖이어도 포함
 * 4. me — 식별 불가/미완주면 null
 * 5. 없는 회차 → 404 ROUND_NOT_FOUND
 * 6. roundId 형식 오류 → 422 VALIDATION_ERROR
 */

import request from "supertest";
import crypto from "crypto";
import app from "../app";
import {
  createTestRound,
  cleanupTestRounds,
  cleanupTestLiveUsers,
  insertTestSession,
} from "./helpers/live.helper";

const createdRoundIds: number[] = [];

afterAll(async () => {
  await cleanupTestRounds(createdRoundIds);
  await cleanupTestLiveUsers();
});

/** 게스트 세션 하나를 완주 상태로 심는다 */
async function seedCompletedGuest(
  roundId: number,
  nickname: string,
  elapsedMs: number,
  seatLabel: string,
): Promise<string> {
  const guestUuid = crypto.randomUUID();
  await insertTestSession({
    roundId,
    guestUuid,
    nickname,
    status: "completed",
    elapsedMs,
    seatLabel,
  });
  return guestUuid;
}

describe("GET /api/live/rounds/:roundId/rankings", () => {
  it("[1] 완주자만 elapsed_ms ASC 로 내려온다", async () => {
    const { roundId } = await createTestRound({ status: "open" });
    createdRoundIds.push(roundId);

    await seedCompletedGuest(roundId, "__tlv_slow", 9000, "A-1-1");
    await seedCompletedGuest(roundId, "__tlv_fast", 3000, "A-1-2");
    // 미완주 세션 — 순위에 잡히면 안 된다
    await insertTestSession({
      roundId,
      guestUuid: crypto.randomUUID(),
      nickname: "__tlv_active",
      status: "active",
    });

    const res = await request(app).get(`/api/live/rounds/${roundId}/rankings`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({
      rank: 1,
      nickname: "__tlv_fast",
      elapsed_ms: 3000,
      is_verified: false,
      seat_label: "A-1-2",
    });
    expect(res.body.data[1].rank).toBe(2);
    expect(res.body.meta).toMatchObject({
      page: 1,
      size: 20,
      totalCount: 2,
      roundId,
      roundStatus: "open",
    });
    // 쿠키 없는 요청 → me 는 null
    expect(res.body.me).toBeNull();
  });

  it("[2] 동률은 같은 등수를 공유한다", async () => {
    const { roundId } = await createTestRound({ status: "open" });
    createdRoundIds.push(roundId);

    await seedCompletedGuest(roundId, "__tlv_tie_a", 5000, "A-1-1");
    await seedCompletedGuest(roundId, "__tlv_tie_b", 5000, "A-1-2");
    await seedCompletedGuest(roundId, "__tlv_third", 7000, "A-1-3");

    const res = await request(app).get(`/api/live/rounds/${roundId}/rankings`);

    expect(res.status).toBe(200);
    const ranks = res.body.data.map((r: { rank: number }) => r.rank);
    // RANK(): 1, 1, 3
    expect(ranks).toEqual([1, 1, 3]);
  });

  it("[3] me — 페이지 밖이어도 내 행이 포함된다", async () => {
    const { roundId } = await createTestRound({ status: "open" });
    createdRoundIds.push(roundId);

    await seedCompletedGuest(roundId, "__tlv_p1", 1000, "A-1-1");
    await seedCompletedGuest(roundId, "__tlv_p2", 2000, "A-1-2");
    const myUuid = await seedCompletedGuest(roundId, "__tlv_me", 8000, "A-1-3");

    const res = await request(app)
      .get(`/api/live/rounds/${roundId}/rankings?page=1&size=1`)
      .set("Cookie", [`guest_uuid=${myUuid}`]);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].nickname).toBe("__tlv_p1");
    expect(res.body.me).toMatchObject({
      rank: 3,
      nickname: "__tlv_me",
      elapsed_ms: 8000,
    });
    expect(res.body.meta.totalCount).toBe(3);
  });

  it("[4] me — 그 회차를 완주하지 않았으면 null", async () => {
    const { roundId } = await createTestRound({ status: "open" });
    createdRoundIds.push(roundId);

    await seedCompletedGuest(roundId, "__tlv_other", 4000, "A-1-1");

    const res = await request(app)
      .get(`/api/live/rounds/${roundId}/rankings`)
      .set("Cookie", [`guest_uuid=${crypto.randomUUID()}`]);

    expect(res.status).toBe(200);
    expect(res.body.me).toBeNull();
  });

  it("[5] 없는 회차 → 404 ROUND_NOT_FOUND", async () => {
    const res = await request(app).get("/api/live/rounds/99999999/rankings");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ROUND_NOT_FOUND");
  });

  it("[6] roundId 형식 오류 → 422 VALIDATION_ERROR", async () => {
    const res = await request(app).get("/api/live/rounds/abc/rankings");

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
