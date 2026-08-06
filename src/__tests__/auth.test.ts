import request from "supertest";
import app from "../app";
import {
  cleanupTestUsers,
  uniqueEmail,
  uniqueUserName,
} from "./setup";

const VALID_PASSWORD = "test1234!";

describe("Auth API", () => {
  beforeAll(cleanupTestUsers);
  afterAll(cleanupTestUsers);

  describe("[1] POST /api/auth/register", () => {
    it("정상 회원가입 시 201 + userId/email/name 반환", async () => {
      const email = uniqueEmail();
      const name = uniqueUserName();

      const res = await request(app)
        .post("/api/auth/register")
        .set("Content-Type", "application/json")
        .send({ email, password: VALID_PASSWORD, name });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.userId).toBeGreaterThan(0);
      expect(res.body.data.email).toBe(email);
      expect(res.body.data.name).toBe(name);
    });

    it("중복 이메일 회원가입 시 409 EMAIL_EXISTS", async () => {
      const email = uniqueEmail();
      await request(app)
        .post("/api/auth/register")
        .set("Content-Type", "application/json")
        .send({ email, password: VALID_PASSWORD, name: uniqueUserName() });

      const res = await request(app)
        .post("/api/auth/register")
        .set("Content-Type", "application/json")
        .send({ email, password: VALID_PASSWORD, name: uniqueUserName() });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("EMAIL_EXISTS");
    });

    it("잘못된 이메일 형식 → 422 VALIDATION_ERROR", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .set("Content-Type", "application/json")
        .send({
          email: "not-an-email",
          password: VALID_PASSWORD,
          name: uniqueUserName(),
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("비밀번호 8자 미만 → 422 VALIDATION_ERROR", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .set("Content-Type", "application/json")
        .send({
          email: uniqueEmail(),
          password: "1234567",
          name: uniqueUserName(),
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("이름 규칙 위반 (특수문자) → 422 VALIDATION_ERROR", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .set("Content-Type", "application/json")
        .send({
          email: uniqueEmail(),
          password: VALID_PASSWORD,
          name: "user@!#",
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("[2] POST /api/auth/login", () => {
    it("정상 로그인 시 200 + userInfo + HttpOnly 쿠키 2종 발급", async () => {
      const email = uniqueEmail();
      const name = uniqueUserName();
      await request(app)
        .post("/api/auth/register")
        .set("Content-Type", "application/json")
        .send({ email, password: VALID_PASSWORD, name });

      const res = await request(app)
        .post("/api/auth/login")
        .set("Content-Type", "application/json")
        .send({ email, password: VALID_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.data.userInfo.email).toBe(email);
      expect(res.body.data.userInfo.name).toBe(name);
      // 응답 body에 accessToken 없어야 함 (HttpOnly 이관 확인)
      expect(res.body.data.accessToken).toBeUndefined();

      const setCookie = res.headers["set-cookie"] as unknown as string[];
      const access = setCookie.find((c) => c.startsWith("accessToken="));
      const refresh = setCookie.find((c) => c.startsWith("refreshToken="));
      expect(access).toBeDefined();
      expect(refresh).toBeDefined();
      expect(access).toMatch(/HttpOnly/i);
      expect(access).toMatch(/SameSite=Strict/i);
      expect(refresh).toMatch(/HttpOnly/i);
      expect(refresh).toMatch(/SameSite=Strict/i);
    });

    it("비밀번호 틀리면 401 INVALID_CREDENTIALS", async () => {
      const email = uniqueEmail();
      await request(app)
        .post("/api/auth/register")
        .set("Content-Type", "application/json")
        .send({ email, password: VALID_PASSWORD, name: uniqueUserName() });

      const res = await request(app)
        .post("/api/auth/login")
        .set("Content-Type", "application/json")
        .send({ email, password: "wrongpassword" });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    it("존재하지 않는 이메일이면 401 INVALID_CREDENTIALS", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .set("Content-Type", "application/json")
        .send({ email: uniqueEmail(), password: VALID_PASSWORD });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    });
  });

  describe("[3] POST /api/auth/refresh", () => {
    it("유효한 refreshToken 쿠키로 200 + 새 accessToken 쿠키 발급", async () => {
      const email = uniqueEmail();
      const agent = request.agent(app);
      await request(app)
        .post("/api/auth/register")
        .set("Content-Type", "application/json")
        .send({ email, password: VALID_PASSWORD, name: uniqueUserName() });
      await agent
        .post("/api/auth/login")
        .set("Content-Type", "application/json")
        .send({ email, password: VALID_PASSWORD });

      const res = await agent.post("/api/auth/refresh");

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
      const setCookie = res.headers["set-cookie"] as unknown as string[];
      expect(setCookie.find((c) => c.startsWith("accessToken="))).toBeDefined();
    });

    it("refreshToken 쿠키 없이 호출 시 401 AUTH_INVALID_TOKEN", async () => {
      const res = await request(app).post("/api/auth/refresh");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("AUTH_INVALID_TOKEN");
    });

    it("위조된 refreshToken 쿠키로 호출 시 401 AUTH_INVALID_TOKEN", async () => {
      const res = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", "refreshToken=invalid.jwt.token");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("AUTH_INVALID_TOKEN");
    });
  });

  describe("[4] POST /api/auth/logout", () => {
    it("로그인 상태에서 로그아웃 시 200 + 쿠키 clear 응답", async () => {
      const email = uniqueEmail();
      const agent = request.agent(app);
      await request(app)
        .post("/api/auth/register")
        .set("Content-Type", "application/json")
        .send({ email, password: VALID_PASSWORD, name: uniqueUserName() });
      await agent
        .post("/api/auth/login")
        .set("Content-Type", "application/json")
        .send({ email, password: VALID_PASSWORD });

      const res = await agent.post("/api/auth/logout");
      expect(res.status).toBe(200);

      const setCookie = res.headers["set-cookie"] as unknown as string[];
      // clearCookie는 Expires 과거 날짜로 설정
      const cleared = setCookie.some((c) =>
        c.match(/(accessToken|refreshToken)=;/),
      );
      expect(cleared).toBe(true);
    });

    it("미인증 상태에서 로그아웃 시도 시 401 AUTH_TOKEN_MISSING", async () => {
      const res = await request(app).post("/api/auth/logout");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });
  });
});
