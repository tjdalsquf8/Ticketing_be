import crypto from "crypto";
import request from "supertest";
import app from "../app";
import pool from "../config/db";
import { cleanupTestPracticeSessions, uniqueNickname } from "./setup";
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
  rank: number,
): Promise<void> {
  const serial = crypto.randomUUID().replace(/-/g, "").substring(0, 12).toUpperCase();
  await pool.query(
    `INSERT INTO tickets
       (live_session_id, user_id, round_id, event_id, passenger_nickname,
        serial, seat_label, elapsed_ms, rank, total_participants)
     VALUES ($1, $2, $3, NULL, 'test_nick', $4, 'A-1-1', 5000, $5, 0)`,
    [sessionDbId, userId, roundId, serial, rank],
  );
}

/** 유료 이벤트 티켓(round_id NULL, event_id 기준) 직접 삽입 */
async function insertPaidEventTicket(
  userId: number,
  sessionDbId: number,
  rank: number,
): Promise<void> {
  const serial = crypto.randomUUID().replace(/-/g, "").substring(0, 12).toUpperCase();
  await pool.query(
    `INSERT INTO tickets
       (live_session_id, user_id, round_id, event_id, passenger_nickname,
        serial, seat_label, elapsed_ms, rank, total_participants)
     VALUES ($1, $2, NULL, NULL, 'test_nick', $3, 'A-1-1', 5000, $4, 0)`,
    [sessionDbId, userId, serial, rank],
  );
}

describe("Rankings API", () => {
  beforeAll(cleanupTestPracticeSessions);
  afterAll(cleanupTestPracticeSessions);

  describe("[6] 랭킹 쿼리 필터 (ranking_eligible)", () => {
    it("impostor 세션은 랭킹 조회 결과에서 제외된다", async () => {
      const nickname = uniqueNickname();
      const agentOwner = request.agent(app);
      const agentImpostor = request.agent(app);

      // Owner: 세션 시작 + 완료
      const ownerStart = await agentOwner
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname });
      await agentOwner
        .post(`/api/practice/sessions/${ownerStart.body.data.sessionId}/complete`)
        .set("Content-Type", "application/json")
        .send({ clientElapsedMs: 5000 });

      // Impostor: 세션 시작 + 완료 (더 빠른 기록이라도 랭킹에 반영되면 안 됨)
      const impostorStart = await agentImpostor
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname });
      await agentImpostor
        .post(`/api/practice/sessions/${impostorStart.body.data.sessionId}/complete`)
        .set("Content-Type", "application/json")
        .send({ clientElapsedMs: 1000 });

      // 랭킹 조회
      const res = await request(app).get(
        "/api/rankings?mode=practice&period=daily&page=1&size=100",
      );
      expect(res.status).toBe(200);

      // 같은 nickname을 가진 row는 오직 1개 (impostor 제외됨)
      const matches = res.body.data.filter(
        (r: { nickname: string }) => r.nickname === nickname,
      );
      expect(matches.length).toBe(1);
      // 게스트 세션이므로 is_verified = false
      expect(matches[0].is_verified).toBe(false);
    });
  });

  describe("[7] 티켓 누적 랭킹 (mode=ticket)", () => {
    const createdRoundIds: number[] = [];

    afterAll(async () => {
      await cleanupTestLiveUsers();
      await cleanupTestRounds(createdRoundIds);
    });

    it("사용자별 누적 티켓 수 내림차순으로 랭킹을 반환한다", async () => {
      const userA = await createTestUser();
      const userB = await createTestUser();
      const round1 = await createTestRound();
      const round2 = await createTestRound();
      createdRoundIds.push(round1.roundId, round2.roundId);

      const sessionA1 = await insertTestSession({
        roundId: round1.roundId,
        userId: userA.userId,
        status: "completed",
      });
      const sessionA2 = await insertTestSession({
        roundId: round2.roundId,
        userId: userA.userId,
        status: "completed",
      });
      const sessionB1 = await insertTestSession({
        roundId: round1.roundId,
        userId: userB.userId,
        status: "completed",
      });

      await insertTicket(userA.userId, round1.roundId, sessionA1.sessionDbId, 1);
      await insertTicket(userA.userId, round2.roundId, sessionA2.sessionDbId, 1);
      await insertTicket(userB.userId, round1.roundId, sessionB1.sessionDbId, 2);
      // 유료 이벤트 티켓(round_id NULL)은 누적 랭킹 집계에서 제외되어야 함
      await insertPaidEventTicket(userA.userId, sessionA1.sessionDbId, 1);

      const res = await request(app).get(
        "/api/rankings?mode=ticket&page=1&size=100",
      );
      expect(res.status).toBe(200);

      const rowA = res.body.data.find(
        (r: { userId: number }) => r.userId === userA.userId,
      );
      const rowB = res.body.data.find(
        (r: { userId: number }) => r.userId === userB.userId,
      );
      expect(Number(rowA.ticketCount)).toBe(2);
      expect(Number(rowB.ticketCount)).toBe(1);
      expect(Number(rowA.rank)).toBeLessThan(Number(rowB.rank));
    });

    it("period 없이 요청해도 400이 아니다", async () => {
      const res = await request(app).get("/api/rankings?mode=ticket");
      expect(res.status).toBe(200);
    });
  });
});
