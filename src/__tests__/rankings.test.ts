import request from "supertest";
import app from "../app";
import { cleanupTestPracticeSessions, uniqueNickname } from "./setup";
import {
  createTestUser,
  createTestRound,
  insertTestSession,
  cleanupTestRounds,
  cleanupTestLiveUsers,
} from "./helpers/live.helper";

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

  describe("[7] GET /api/rankings/me — 내 기록", () => {
    const createdRoundIds: number[] = [];

    afterAll(async () => {
      await cleanupTestLiveUsers();
      await cleanupTestRounds(createdRoundIds);
    });

    async function loginAgent(email: string, password: string) {
      const agent = request.agent(app);
      await agent
        .post("/api/auth/login")
        .set("Content-Type", "application/json")
        .send({ email, password });
      return agent;
    }

    it("본인의 완주 기록을 시도 단위로 전부 반환한다", async () => {
      const user = await createTestUser();
      const round1 = await createTestRound();
      const round2 = await createTestRound();
      createdRoundIds.push(round1.roundId, round2.roundId);

      await insertTestSession({
        roundId: round1.roundId,
        userId: user.userId,
        status: "completed",
        elapsedMs: 5000,
      });
      await insertTestSession({
        roundId: round2.roundId,
        userId: user.userId,
        status: "completed",
        elapsedMs: 9000,
      });

      const agent = await loginAgent(user.email, user.password);
      const res = await agent.get("/api/rankings/me?mode=live&period=daily");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.totalCount).toBe(2);

      const elapsed = res.body.data.map((r: { elapsed_ms: number }) => r.elapsed_ms).sort();
      expect(elapsed).toEqual([5000, 9000]);
      // best_ms 는 FE 호환 필드로 그 시도의 elapsed_ms 와 같은 값
      for (const row of res.body.data) {
        expect(row.best_ms).toBe(row.elapsed_ms);
        expect(row.is_verified).toBe(true);
      }
    });

    it("랭킹 상위권 밖 기록도 rank 와 함께 반환한다", async () => {
      const me = await createTestUser();
      const round = await createTestRound();
      createdRoundIds.push(round.roundId);

      // 나보다 빠른 참가자 3명
      for (let i = 1; i <= 3; i++) {
        const faster = await createTestUser();
        await insertTestSession({
          roundId: round.roundId,
          userId: faster.userId,
          status: "completed",
          elapsedMs: i * 100,
        });
      }
      await insertTestSession({
        roundId: round.roundId,
        userId: me.userId,
        status: "completed",
        elapsedMs: 90000,
      });

      const agent = await loginAgent(me.email, me.password);
      const res = await agent.get("/api/rankings/me?mode=live&period=daily");

      expect(res.status).toBe(200);
      const mine = res.body.data.find(
        (r: { elapsed_ms: number }) => r.elapsed_ms === 90000,
      );
      expect(mine).toBeDefined();
      // 나보다 빠른 사람이 최소 3명이므로 4위 이하. rank 는 number 여야 한다.
      expect(typeof mine.rank).toBe("number");
      expect(mine.rank).toBeGreaterThanOrEqual(4);
    });

    it("미인증 요청은 401", async () => {
      const res = await request(app).get("/api/rankings/me?mode=live&period=daily");
      expect(res.status).toBe(401);
    });

    it("잘못된 period 는 422", async () => {
      const user = await createTestUser();
      const agent = await loginAgent(user.email, user.password);
      const res = await agent.get("/api/rankings/me?mode=live&period=yearly");
      expect(res.status).toBe(422);
    });

    it("mode=ticket 은 더 이상 지원하지 않는다 (422)", async () => {
      const res = await request(app).get("/api/rankings?mode=ticket&period=daily");
      expect(res.status).toBe(422);
    });
  });
});
