import request from "supertest";
import app from "../app";
import { cleanupTestPracticeSessions, cleanupTestGuests, uniqueNickname } from "./setup";

describe("Guests API", () => {
  beforeAll(async () => {
    await cleanupTestPracticeSessions();
    await cleanupTestGuests();
  });
  afterAll(async () => {
    await cleanupTestPracticeSessions();
    await cleanupTestGuests();
  });

  describe("[G-1] POST /api/guests — 게스트 UUID 발급", () => {
    it("[G-1-1] 쿠키 없는 첫 요청 → 201, guestUuid 발급 + Set-Cookie guest_uuid", async () => {
      const res = await request(app)
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.guestUuid).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.data.nickname).toBeDefined();

      const setCookie = res.headers["set-cookie"] as string[] | undefined;
      expect(setCookie).toBeDefined();
      const guestCookie = (setCookie ?? []).find((c: string) =>
        c.startsWith("guest_uuid="),
      );
      expect(guestCookie).toBeDefined();
      expect(guestCookie).toMatch(/HttpOnly/i);
    });

    it("[G-1-2] nickname 포함 요청 → 201, 해당 nickname 반환", async () => {
      const nickname = uniqueNickname();
      const res = await request(app)
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({ nickname });

      expect(res.status).toBe(201);
      expect(res.body.data.nickname).toBe(nickname);
    });

    it("[G-1-3] 이미 쿠키 있으면 기존 guestUuid 그대로 반환 (idempotent)", async () => {
      const agent = request.agent(app);

      // 첫 발급
      const first = await agent.post("/api/guests").send({});
      expect(first.status).toBe(201);
      const uuidFirst = first.body.data.guestUuid;

      // 두 번째 요청 — 쿠키 이미 agent에 세팅됨
      const second = await agent.post("/api/guests").send({});
      expect(second.status).toBe(201);
      expect(second.body.data.guestUuid).toBe(uuidFirst);
    });

    it("[G-1-4] nickname이 31자 이상이면 422 VALIDATION_ERROR", async () => {
      const res = await request(app)
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({ nickname: "a".repeat(31) });

      expect(res.status).toBe(422);
    });

    it("[G-1-5] 쿠키 있고 새 nickname 전달 시 DB에 nickname 갱신됨", async () => {
      const agent = request.agent(app);
      const nicknameFirst = uniqueNickname();
      const nicknameSecond = uniqueNickname();

      // 첫 발급
      await agent.post("/api/guests").send({ nickname: nicknameFirst });

      // nickname 갱신 요청
      const updateRes = await agent.post("/api/guests").send({ nickname: nicknameSecond });
      expect(updateRes.status).toBe(201);
      expect(updateRes.body.data.nickname).toBe(nicknameSecond);

      // GET /me로 갱신된 nickname 확인
      const meRes = await agent.get("/api/guests/me");
      expect(meRes.status).toBe(200);
      expect(meRes.body.data.nickname).toBe(nicknameSecond);
    });
  });

  describe("[7] GET /api/guests/me", () => {
    it("쿠키 없으면 401 GUEST_NOT_AUTHENTICATED", async () => {
      const res = await request(app).get("/api/guests/me");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("GUEST_NOT_AUTHENTICATED");
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

    it("[G-2-3] POST /api/guests 후 practice 세션 없어도 GET /me에서 nickname 복구됨 (버그 재현 방지)", async () => {
      const nickname = uniqueNickname();
      const agent = request.agent(app);

      // practice 세션 없이 POST /guests만으로 게스트 등록
      const postRes = await agent
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({ nickname });

      expect(postRes.status).toBe(201);
      expect(postRes.body.data.nickname).toBe(nickname);

      // 쿠키만 있고 practice 세션 이력이 없어도 GET /me 성공해야 함
      const meRes = await agent.get("/api/guests/me");
      expect(meRes.status).toBe(200);
      expect(meRes.body.success).toBe(true);
      expect(meRes.body.data.nickname).toBe(nickname);
      expect(meRes.body.data.guestUuid).toMatch(/^[0-9a-f-]{36}$/);
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

      // 3. GET /me → 401 (쿠키 없음)
      const afterDelete = await agent.get("/api/guests/me");
      expect(afterDelete.status).toBe(401);

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
