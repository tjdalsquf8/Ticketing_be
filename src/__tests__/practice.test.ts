import request from "supertest";
import app from "../app";
import pool from "../config/db";
import { cleanupTestPracticeSessions, uniqueNickname } from "./setup";

describe("Practice API", () => {
  beforeAll(cleanupTestPracticeSessions);
  afterAll(cleanupTestPracticeSessions);

  describe("[1] 쿠키 발급", () => {
    it("게스트 첫 세션 시작 시 HttpOnly guest_uuid 쿠키가 발급된다", async () => {
      const nickname = uniqueNickname();
      const res = await request(app)
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sessionId).toMatch(/^prc_[a-f0-9]{16}$/);
      expect(res.body.data.nickname).toBe(nickname);
      expect(res.body.data.startedAt).toBeDefined();

      const setCookie = res.headers["set-cookie"] as unknown as string[];
      expect(setCookie).toBeDefined();
      const guestCookie = setCookie.find((c) => c.startsWith("guest_uuid="));
      expect(guestCookie).toBeDefined();
      expect(guestCookie).toMatch(/guest_uuid=[0-9a-f-]{36}/);
      expect(guestCookie).toMatch(/HttpOnly/i);
      expect(guestCookie).toMatch(/SameSite=Strict/i);
    });
  });

  describe("[2] 닉네임 immutability", () => {
    it("같은 쿠키(UUID)로 다른 닉네임 보내도 원래 닉네임으로 강제된다", async () => {
      const originalNickname = uniqueNickname();
      const attemptedNickname = uniqueNickname();
      const agent = request.agent(app);

      const res1 = await agent
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname: originalNickname });
      expect(res1.status).toBe(201);
      expect(res1.body.data.nickname).toBe(originalNickname);

      const res2 = await agent
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname: attemptedNickname });
      expect(res2.status).toBe(201);
      // ✅ 프론트가 다른 닉 보내도 백엔드가 원래 닉으로 override
      expect(res2.body.data.nickname).toBe(originalNickname);
    });
  });

  describe("[3] 소유권 체크 (impostor)", () => {
    it("다른 게스트(UUID)가 같은 닉네임으로 세션 생성 시 ranking_eligible=false로 저장된다", async () => {
      const nickname = uniqueNickname();
      const agentOwner = request.agent(app);
      const agentImpostor = request.agent(app);

      // Owner: 최초 소유자
      const resOwner = await agentOwner
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname });
      expect(resOwner.status).toBe(201);

      // Owner의 세션은 ranking_eligible = true
      const ownerSessionId = resOwner.body.data.sessionId;
      const dbOwner = await pool.query(
        `SELECT ranking_eligible FROM practice_sessions WHERE session_id = $1`,
        [ownerSessionId],
      );
      expect(dbOwner.rows[0].ranking_eligible).toBe(true);

      // Impostor: 같은 닉네임
      const resImpostor = await agentImpostor
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname });
      expect(resImpostor.status).toBe(201);

      // Impostor의 세션은 ranking_eligible = false
      const impostorSessionId = resImpostor.body.data.sessionId;
      const dbImpostor = await pool.query(
        `SELECT ranking_eligible FROM practice_sessions WHERE session_id = $1`,
        [impostorSessionId],
      );
      expect(dbImpostor.rows[0].ranking_eligible).toBe(false);
    });
  });

  describe("[4] ranked 필드 처리", () => {
    it("impostor 세션 완료 시 응답에 ranked=false, rank 필드는 모두 null", async () => {
      const nickname = uniqueNickname();
      const agentOwner = request.agent(app);
      const agentImpostor = request.agent(app);

      await agentOwner
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname });

      const startRes = await agentImpostor
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname });
      const sessionId = startRes.body.data.sessionId;

      const completeRes = await agentImpostor
        .post(`/api/practice/sessions/${sessionId}/complete`)
        .set("Content-Type", "application/json")
        .send({ clientElapsedMs: 5000 });

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.data.ranked).toBe(false);
      expect(completeRes.body.data.rankPercentile).toBeNull();
      expect(completeRes.body.data.rankNumber).toBeNull();
      expect(completeRes.body.data.totalCount).toBeNull();
      // 시간은 정상 반환
      expect(typeof completeRes.body.data.elapsedMs).toBe("number");
    });

    it("정식 소유자가 세션 완료 시 응답에 ranked=true, rank 필드는 숫자", async () => {
      const nickname = uniqueNickname();
      const agent = request.agent(app);

      const startRes = await agent
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname });
      const sessionId = startRes.body.data.sessionId;

      const completeRes = await agent
        .post(`/api/practice/sessions/${sessionId}/complete`)
        .set("Content-Type", "application/json")
        .send({ clientElapsedMs: 5000 });

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.data.ranked).toBe(true);
      expect(typeof completeRes.body.data.rankPercentile).toBe("number");
      expect(typeof completeRes.body.data.rankNumber).toBe("number");
      expect(typeof completeRes.body.data.totalCount).toBe("number");
    });
  });

  describe("[5] 에러 케이스", () => {
    it("존재하지 않는 세션 완료 시 404 SESSION_NOT_FOUND", async () => {
      const agent = request.agent(app);
      // 쿠키 확보를 위해 하나 만들고
      await agent
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname: uniqueNickname() });

      const res = await agent
        .post("/api/practice/sessions/prc_ffffffffffffffff/complete")
        .set("Content-Type", "application/json")
        .send({ clientElapsedMs: 5000 });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("SESSION_NOT_FOUND");
    });

    it("다른 게스트의 세션 완료 시도 시 403 SESSION_FORBIDDEN", async () => {
      const agentA = request.agent(app);
      const agentB = request.agent(app);

      // A가 세션 생성
      const resA = await agentA
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname: uniqueNickname() });
      const aSessionId = resA.body.data.sessionId;

      // B는 자기 쿠키 세팅
      await agentB
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname: uniqueNickname() });

      // B가 A 세션 완료 시도
      const res = await agentB
        .post(`/api/practice/sessions/${aSessionId}/complete`)
        .set("Content-Type", "application/json")
        .send({ clientElapsedMs: 5000 });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("SESSION_FORBIDDEN");
    });

    it("이미 완료된 세션 재완료 시 409 SESSION_ALREADY_COMPLETED", async () => {
      const agent = request.agent(app);
      const startRes = await agent
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname: uniqueNickname() });
      const sessionId = startRes.body.data.sessionId;

      // 첫 완료
      await agent
        .post(`/api/practice/sessions/${sessionId}/complete`)
        .set("Content-Type", "application/json")
        .send({ clientElapsedMs: 5000 });

      // 재완료 시도
      const res = await agent
        .post(`/api/practice/sessions/${sessionId}/complete`)
        .set("Content-Type", "application/json")
        .send({ clientElapsedMs: 5000 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SESSION_ALREADY_COMPLETED");
    });

    it("게스트가 쿠키 없이 세션 완료 시도 시 401 GUEST_UUID_MISSING", async () => {
      // 쿠키 없는 fresh request
      const res = await request(app)
        .post("/api/practice/sessions/prc_ffffffffffffffff/complete")
        .set("Content-Type", "application/json")
        .send({ clientElapsedMs: 5000 });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("GUEST_UUID_MISSING");
    });

    it("첫 방문 게스트가 닉네임 없이 세션 시작 시 400 NICKNAME_REQUIRED", async () => {
      const res = await request(app)
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("NICKNAME_REQUIRED");
    });
  });
});
