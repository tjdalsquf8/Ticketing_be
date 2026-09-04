import crypto from "crypto";
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

async function insertTicket(
  userId: number,
  roundId: number,
  sessionDbId: number,
  elapsedMs: number,
): Promise<void> {
  const serial = crypto.randomUUID().replace(/-/g, "").substring(0, 12).toUpperCase();
  await pool.query(
    `INSERT INTO tickets
       (live_session_id, user_id, round_id, event_id, passenger_nickname,
        serial, seat_label, elapsed_ms, rank, total_participants)
     VALUES ($1, $2, $3, NULL, 'test_nick', $4, 'A-1-1', $5, 1, 1)`,
    [sessionDbId, userId, roundId, serial, elapsedMs],
  );
}

describe("Stats API", () => {
  const createdRoundIds: number[] = [];

  afterAll(async () => {
    await cleanupTestLiveUsers();
    await cleanupTestRounds(createdRoundIds);
  });

  it("오늘 발급 티켓 수 / 오늘 참여자 수 / 이번 주 최고 기록을 반환한다", async () => {
    const user = await createTestUser();
    const round = await createTestRound();
    createdRoundIds.push(round.roundId);

    const session = await insertTestSession({
      roundId: round.roundId,
      userId: user.userId,
      status: "completed",
    });
    await insertTicket(user.userId, round.roundId, session.sessionDbId, 42);

    const res = await request(app).get("/api/stats/daily");
    expect(res.status).toBe(200);

    const { ticketsIssuedToday, participantsToday, fastestMsThisWeek } =
      res.body.data;
    expect(typeof ticketsIssuedToday).toBe("number");
    expect(typeof participantsToday).toBe("number");
    expect(ticketsIssuedToday).toBeGreaterThanOrEqual(1);
    expect(participantsToday).toBeGreaterThanOrEqual(1);
    expect(fastestMsThisWeek).toBeLessThanOrEqual(42);
  });

  it("TTL 캐시 범위 내 요청은 이후 삽입을 즉시 반영하지 않는다", async () => {
    const first = await request(app).get("/api/stats/daily");

    const user = await createTestUser();
    const round = await createTestRound();
    createdRoundIds.push(round.roundId);
    const session = await insertTestSession({
      roundId: round.roundId,
      userId: user.userId,
      status: "completed",
    });
    await insertTicket(user.userId, round.roundId, session.sessionDbId, 1);

    const second = await request(app).get("/api/stats/daily");
    expect(second.body.data).toEqual(first.body.data);
  });
});
