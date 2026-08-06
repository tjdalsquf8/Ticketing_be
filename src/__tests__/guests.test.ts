import request from "supertest";
import app from "../app";
import { cleanupTestPracticeSessions, uniqueNickname } from "./setup";

describe("Guests API", () => {
  beforeAll(cleanupTestPracticeSessions);
  afterAll(cleanupTestPracticeSessions);

  describe("[7] GET /api/guests/me", () => {
    it("쿠키 없으면 404 GUEST_NOT_FOUND", async () => {
      const res = await request(app).get("/api/guests/me");
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("GUEST_NOT_FOUND");
    });

    it("쿠키 있고 세션 이력 있으면 200 + guestUuid + nickname", async () => {
      const nickname = uniqueNickname();
      const agent = request.agent(app);

      await agent
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname });

      const res = await agent.get("/api/guests/me");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.nickname).toBe(nickname);
      expect(res.body.data.guestUuid).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe("[8] DELETE /api/guests/me", () => {
    it("쿠키 삭제 응답 후 다음 요청에서 GET /me는 404, 새 세션은 새 UUID 발급", async () => {
      const agent = request.agent(app);
      const nickname1 = uniqueNickname();
      const nickname2 = uniqueNickname();

      // 1. 첫 세션 → 쿠키 발급
      await agent
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname: nickname1 });

      const before = await agent.get("/api/guests/me");
      expect(before.status).toBe(200);
      const uuidBefore = before.body.data.guestUuid;

      // 2. DELETE /me → 쿠키 clear
      const delRes = await agent.delete("/api/guests/me");
      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);

      // 3. GET /me → 404 (쿠키 없음)
      const afterDelete = await agent.get("/api/guests/me");
      expect(afterDelete.status).toBe(404);

      // 4. 새 세션 시작 → 새 UUID 발급됨
      await agent
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname: nickname2 });

      const after = await agent.get("/api/guests/me");
      expect(after.status).toBe(200);
      const uuidAfter = after.body.data.guestUuid;

      // 완전히 다른 UUID + 다른 nickname
      expect(uuidAfter).not.toBe(uuidBefore);
      expect(after.body.data.nickname).toBe(nickname2);
    });
  });
});
