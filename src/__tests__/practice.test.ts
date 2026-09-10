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

  describe("[2] 닉네임 변경", () => {
    it("같은 쿠키(UUID)로 다른 닉네임 보내면 새 닉네임이 그대로 저장된다", async () => {
      // 회귀 방지: 예전에는 그 UUID 의 최초 세션 닉네임으로 요청값을 덮어써서
      // (immutability) 게스트가 닉네임을 영구히 바꿀 수 없었다.
      const firstNickname = uniqueNickname();
      const newNickname = uniqueNickname();
      const agent = request.agent(app);

      const res1 = await agent
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname: firstNickname });
      expect(res1.status).toBe(201);
      expect(res1.body.data.nickname).toBe(firstNickname);

      const res2 = await agent
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname: newNickname });
      expect(res2.status).toBe(201);
      expect(res2.body.data.nickname).toBe(newNickname);

      const db = await pool.query(
        `SELECT nickname FROM practice_sessions WHERE session_id = $1`,
        [res2.body.data.sessionId],
      );
      expect(db.rows[0].nickname).toBe(newNickname);
    });
  });

  describe("[3] 닉네임 중복", () => {
    it("다른 게스트(UUID)가 같은 닉네임을 써도 ranking_eligible=true 로 저장된다", async () => {
      // 회귀 방지: 예전에는 그 닉네임을 먼저 쓴 guest_uuid 가 아니면 사칭으로 보고
      // ranking_eligible=false 로 랭킹에서 제외했다. 개명이 자유로워진 지금은
      // 남이 버린 닉네임을 골랐을 뿐인 유저의 기록까지 조용히 사라지는 오탐이 된다.
      const nickname = uniqueNickname();
      const agentA = request.agent(app);
      const agentB = request.agent(app);

      const resA = await agentA
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname });
      expect(resA.status).toBe(201);

      const resB = await agentB
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname });
      expect(resB.status).toBe(201);

      const db = await pool.query(
        `SELECT ranking_eligible FROM practice_sessions WHERE session_id = ANY($1)`,
        [[resA.body.data.sessionId, resB.body.data.sessionId]],
      );
      expect(db.rows).toHaveLength(2);
      expect(db.rows.every((r) => r.ranking_eligible === true)).toBe(true);
    });
  });

  describe("[4] ranked 필드 처리", () => {
    it("ranking_eligible=false 세션 완료 시 응답에 ranked=false, rank 필드는 모두 null", async () => {
      // ranking_eligible 은 이제 운영자가 개별 기록을 랭킹에서 뺄 때 쓰는 수동 플래그다.
      const agent = request.agent(app);

      const startRes = await agent
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname: uniqueNickname() });
      const sessionId = startRes.body.data.sessionId;

      await pool.query(
        `UPDATE practice_sessions SET ranking_eligible = false WHERE session_id = $1`,
        [sessionId],
      );

      const completeRes = await agent
        .post(`/api/practice/sessions/${sessionId}/complete`)
        .set("Content-Type", "application/json")
        .send({});

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.data.ranked).toBe(false);
      expect(completeRes.body.data.rankPercentile).toBeNull();
      expect(completeRes.body.data.sessionRank).toBeNull();
      expect(completeRes.body.data.totalSessions).toBeNull();
      // 시간은 정상 반환
      expect(typeof completeRes.body.data.elapsedMs).toBe("number");
    });

    it("일반 세션 완료 시 응답에 ranked=true, rank 필드는 숫자", async () => {
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
        .send({});

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.data.ranked).toBe(true);
      expect(typeof completeRes.body.data.rankPercentile).toBe("number");
      expect(typeof completeRes.body.data.sessionRank).toBe("number");
      expect(typeof completeRes.body.data.totalSessions).toBe("number");
    });

    it("rankPercentile 은 등수 비율(상위 %)이다", async () => {
      // 회귀 방지: 예전에는 "나보다 느린 시도의 비율" 을 돌려줘서 1등이 상위 99% 로
      // 표시됐다. 프론트가 이 값을 "상위 N%" 로 그대로 쓰므로 등수 비율이어야 한다.
      const agent = request.agent(app);

      const startRes = await agent
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname: uniqueNickname() });

      const completeRes = await agent
        .post(`/api/practice/sessions/${startRes.body.data.sessionId}/complete`)
        .set("Content-Type", "application/json")
        .send({});

      expect(completeRes.status).toBe(200);
      const { rankPercentile, sessionRank, totalSessions } = completeRes.body.data;

      expect(rankPercentile).toBeCloseTo(
        Math.round((sessionRank / totalSessions) * 1000) / 10,
        5,
      );
      expect(rankPercentile).toBeGreaterThan(0);
      expect(rankPercentile).toBeLessThanOrEqual(100);
    });

    it("같은 게스트가 반복 완료하면 totalSessions 가 매번 증가한다", async () => {
      // 회귀 방지: 예전에는 참가자별로 dedup 해서 같은 사람이 몇 번을 돌려도
      // 값이 참가자 수에 고정됐다.
      const nickname = uniqueNickname();
      const agent = request.agent(app);

      const counts: number[] = [];
      for (let i = 0; i < 3; i++) {
        const startRes = await agent
          .post("/api/practice/sessions")
          .set("Content-Type", "application/json")
          .send({ mode: "practice", nickname });

        const completeRes = await agent
          .post(`/api/practice/sessions/${startRes.body.data.sessionId}/complete`)
          .set("Content-Type", "application/json")
          .send({});

        expect(completeRes.status).toBe(200);
        counts.push(completeRes.body.data.totalSessions);
      }

      expect(counts[1]).toBe(counts[0] + 1);
      expect(counts[2]).toBe(counts[1] + 1);
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
        .send({});

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
        .send({});

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
        .send({});

      // 재완료 시도
      const res = await agent
        .post(`/api/practice/sessions/${sessionId}/complete`)
        .set("Content-Type", "application/json")
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SESSION_ALREADY_COMPLETED");
    });

    it("게스트가 쿠키 없이 세션 완료 시도 시 401 GUEST_UUID_MISSING", async () => {
      // 쿠키 없는 fresh request
      const res = await request(app)
        .post("/api/practice/sessions/prc_ffffffffffffffff/complete")
        .set("Content-Type", "application/json")
        .send({});

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
