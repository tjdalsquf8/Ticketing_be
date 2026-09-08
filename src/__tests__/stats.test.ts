import request from "supertest";
import app from "../app";
import pool from "../config/db";
import {
  createTestUser,
  createTestRound,
  insertTestSession,
  cleanupTestRounds,
  cleanupTestLiveUsers,
} from "./helpers/live.helper";

describe("Stats API", () => {
  const createdRoundIds: number[] = [];

  afterAll(async () => {
    await cleanupTestLiveUsers();
    await cleanupTestRounds(createdRoundIds);
  });

  it("오늘 완주 수 / 오늘 참여자 수 / 이번 주 최고 기록을 반환한다", async () => {
    const user = await createTestUser();
    const round = await createTestRound();
    createdRoundIds.push(round.roundId);

    await insertTestSession({
      roundId: round.roundId,
      userId: user.userId,
      status: "completed",
      elapsedMs: 42,
    });
    // completed_at 은 insertTestSession 이 채우지 않으므로 직접 세팅한다.
    await pool.query(
      `UPDATE live_sessions SET completed_at = NOW()
       WHERE round_id = $1 AND user_id = $2`,
      [round.roundId, user.userId],
    );

    const res = await request(app).get("/api/stats/daily");
    expect(res.status).toBe(200);

    const { completionsToday, participantsToday, fastestMsThisWeek } =
      res.body.data;
    expect(typeof completionsToday).toBe("number");
    expect(typeof participantsToday).toBe("number");
    expect(completionsToday).toBeGreaterThanOrEqual(1);
    expect(participantsToday).toBeGreaterThanOrEqual(1);
    expect(fastestMsThisWeek).toBeLessThanOrEqual(42);
  });

  it("TTL 캐시 범위 내 요청은 이후 삽입을 즉시 반영하지 않는다", async () => {
    const first = await request(app).get("/api/stats/daily");

    const user = await createTestUser();
    const round = await createTestRound();
    createdRoundIds.push(round.roundId);
    await insertTestSession({
      roundId: round.roundId,
      userId: user.userId,
      status: "completed",
      elapsedMs: 1,
    });

    const second = await request(app).get("/api/stats/daily");
    expect(second.body.data).toEqual(first.body.data);
  });
});
