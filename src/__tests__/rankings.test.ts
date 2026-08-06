import request from "supertest";
import app from "../app";
import { cleanupTestPracticeSessions, uniqueNickname } from "./setup";

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
});
