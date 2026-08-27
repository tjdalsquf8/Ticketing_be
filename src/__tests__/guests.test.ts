import request from "supertest";
import app from "../app";
import pool from "../config/db";
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
    it("[8-1] POST /api/guests 발급 직후 삭제 시도 → 429 NICKNAME_CHANGE_TOO_SOON", async () => {
      const agent = request.agent(app);
      const nickname = uniqueNickname();

      // 명시적 게스트 발급 → guests 테이블 INSERT + nickname_changed_at = NOW()
      await agent
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({ nickname });

      // 방금 발급 → 아직 1시간 안 지남
      const delRes = await agent.delete("/api/guests/me");
      expect(delRes.status).toBe(429);
      expect(delRes.body.error.code).toBe("NICKNAME_CHANGE_TOO_SOON");
      expect(delRes.headers["retry-after"]).toBeDefined();

      // 쿠키 유지 확인
      const meRes = await agent.get("/api/guests/me");
      expect(meRes.status).toBe(200);
    });

    it("[8-2] 1시간 지난 게스트는 삭제 성공 → 새 세션은 새 UUID", async () => {
      const agent = request.agent(app);
      const nickname1 = uniqueNickname();
      const nickname2 = uniqueNickname();

      const first = await agent
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({ nickname: nickname1 });
      const uuidBefore = first.body.data.guestUuid;

      // 테스트 목적으로 nickname_changed_at 을 1시간 하고도 1분 전으로 조작
      await pool.query(
        `UPDATE guests SET nickname_changed_at = NOW() - INTERVAL '61 minutes'
         WHERE guest_uuid = $1`,
        [uuidBefore],
      );

      const delRes = await agent.delete("/api/guests/me");
      expect(delRes.status).toBe(200);

      // 쿠키 clear 확인
      const afterDelete = await agent.get("/api/guests/me");
      expect(afterDelete.status).toBe(401);

      // 새 발급 → 새 UUID
      const second = await agent
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({ nickname: nickname2 });
      expect(second.body.data.guestUuid).not.toBe(uuidBefore);
      expect(second.body.data.nickname).toBe(nickname2);
    });

    it("[8-3] 쿠키 없는 상태에서 삭제 요청 → 200 (idempotent)", async () => {
      const res = await request(app).delete("/api/guests/me");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("[8-4] guests 테이블에 row 없는 유령 쿠키 → 200 (idempotent)", async () => {
      // guests 미접점(practice 만 참여) 사용자는 nickname_changed_at 검사 대상 아님.
      const agent = request.agent(app);
      const nickname = uniqueNickname();

      await agent
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname });

      const res = await agent.delete("/api/guests/me");
      expect(res.status).toBe(200);
    });
  });
});
