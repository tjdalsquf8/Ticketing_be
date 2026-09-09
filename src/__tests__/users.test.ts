import request from "supertest";
import app from "../app";
import pool from "../config/db";
import {
  cleanupTestUsers,
  uniqueEmail,
  uniqueUserName,
} from "./setup";

const VALID_PASSWORD = "test1234!";

describe("Users API", () => {
  beforeAll(cleanupTestUsers);
  afterAll(cleanupTestUsers);

  describe("GET /api/users/me", () => {
    it("로그인 상태에서 200 + 유저 정보 반환", async () => {
      const email = uniqueEmail();
      const name = uniqueUserName();
      const agent = request.agent(app);

      await request(app)
        .post("/api/auth/register")
        .set("Content-Type", "application/json")
        .send({ email, password: VALID_PASSWORD, name });
      await agent
        .post("/api/auth/login")
        .set("Content-Type", "application/json")
        .send({ email, password: VALID_PASSWORD });

      const res = await agent.get("/api/users/me");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(email);
      expect(res.body.data.name).toBe(name);
      expect(res.body.data.id).toBeGreaterThan(0);
      expect(res.body.data.created_at).toBeDefined();
      // 비밀번호는 응답에 절대 노출 안 됨
      expect(res.body.data.password).toBeUndefined();
    });

    it("미인증(쿠키 없음) 시 401 AUTH_TOKEN_MISSING", async () => {
      const res = await request(app).get("/api/users/me");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });

    it("위조된 accessToken 쿠키로 요청 시 401 AUTH_INVALID_TOKEN", async () => {
      const res = await request(app)
        .get("/api/users/me")
        .set("Cookie", "accessToken=invalid.jwt.token");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("AUTH_INVALID_TOKEN");
    });

    it("존재하지 않는 유저의 유효한 토큰 → 404 USER_NOT_FOUND", async () => {
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

      // 로그인 후 유저를 DB에서 삭제 (토큰만 살아있음)
      await pool.query(`DELETE FROM users WHERE email = $1`, [email]);

      const res = await agent.get("/api/users/me");
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("USER_NOT_FOUND");
    });
  });
});
