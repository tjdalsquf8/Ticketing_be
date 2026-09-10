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

    it("[G-1-4] nickname 길이 경계: 10자 통과, 11자 이상 422", async () => {
      const ok = await request(app)
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({ nickname: "a".repeat(10) });
      expect(ok.status).toBe(201);

      const tooLong = await request(app)
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({ nickname: "a".repeat(11) });
      expect(tooLong.status).toBe(422);
    });

    it("[G-1-6] 화이트리스트 밖 문자는 거절한다 (시각적 사칭 차단)", async () => {
      // 제로폭 공백(U+200B)·이모지·공백은 눈으로 구분이 안 되거나 렌더가 깨지므로
      // 서버에서 막아야 한다. 프론트 검증은 UX 용이라 curl 로 우회된다.
      const rejected = [
        "김철수​", // U+200B 제로폭 공백 — 눈으로는 "김철수" 와 동일
        "김철수🎫", // 이모지
        "김 철수", // 중간 공백 (trim 으로 안 걷히는 자리)
        "a", // 1자 (min 2)
      ];

      for (const nickname of rejected) {
        const res = await request(app)
          .post("/api/guests")
          .set("Content-Type", "application/json")
          .send({ nickname });
        expect(res.status).toBe(422);
      }

      // 앞뒤 공백은 trim 후 검증하므로 통과하는 게 정상이다.
      const trimmed = await request(app)
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({ nickname: " 김철수 " });
      expect(trimmed.status).toBe(201);
      expect(trimmed.body.data.nickname).toBe("김철수");
    });

    it("[G-1-7] guest_uuid 쿠키는 SameSite=Strict 로 심긴다 (CSRF 신원 교체 차단)", async () => {
      const res = await request(app)
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({});

      const setCookie = (res.headers["set-cookie"] ?? []) as unknown as string[];
      const guestCookie = setCookie.find((c) => c.startsWith("guest_uuid="));
      expect(guestCookie).toBeDefined();
      expect(guestCookie).toMatch(/SameSite=Strict/i);
    });

    it("[G-1-8] 빈 본문 + form Content-Type 은 415 (cross-site form 자동 제출 차단)", async () => {
      // 입력 필드 없는 form 이 자동 제출되면 본문 0바이트 + urlencoded 로 도착한다.
      // 예전에는 content-length 0 이라 Content-Type 검사를 건너뛰어 통과했고,
      // 서버가 피해자에게 새 guest_uuid 를 심어 신원을 교체할 수 있었다.
      const res = await request(app)
        .post("/api/guests")
        .set("Content-Type", "application/x-www-form-urlencoded");

      expect(res.status).toBe(415);
      expect(res.headers["set-cookie"]).toBeUndefined();
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
});
