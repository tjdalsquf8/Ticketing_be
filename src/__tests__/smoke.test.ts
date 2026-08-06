import request from "supertest";
import app from "../app";
import pool from "../config/db";
import { cleanupTestPracticeSessions } from "./setup";

describe("Test Setup Smoke Test", () => {
  afterAll(async () => {
    await cleanupTestPracticeSessions();
  });

  it("Jest + supertest 실행 확인", () => {
    expect(1 + 1).toBe(2);
  });

  it("Express 앱 import + supertest 요청 확인 (404 응답)", async () => {
    const res = await request(app).get("/api/does-not-exist");
    // 존재하지 않는 라우트 = 어떤 응답이든 200이 아니면 OK
    expect(res.status).not.toBe(200);
  });

  it("DB 커넥션 확인 (SELECT NOW())", async () => {
    const result = await pool.query("SELECT NOW() AS now");
    expect(result.rows[0].now).toBeDefined();
  });

  it("cleanupTestPracticeSessions 실행 확인 (에러 없음)", async () => {
    await expect(cleanupTestPracticeSessions()).resolves.not.toThrow();
  });
});
