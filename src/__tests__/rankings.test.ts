import request from "supertest";
import app from "../app";
import pool from "../config/db";
import { cleanupTestPracticeSessions, cleanupTestGuests, uniqueNickname } from "./setup";
import {
  createTestUser,
  createTestRound,
  insertTestSession,
  cleanupTestRounds,
  cleanupTestLiveUsers,
} from "./helpers/live.helper";

describe("Rankings API", () => {
  beforeAll(cleanupTestPracticeSessions);
  afterAll(cleanupTestPracticeSessions);

  describe("[6] 랭킹 쿼리 필터 (ranking_eligible)", () => {
    it("ranking_eligible=false 세션은 랭킹 조회 결과에서 제외된다", async () => {
      // ranking_eligible 은 운영자가 개별 기록을 랭킹에서 뺄 때 쓰는 수동 플래그다.
      // (닉네임 사칭 자동 게이팅은 제거됨 — practice.test.ts [3] 참고)
      const excludedNickname = uniqueNickname();
      const includedNickname = uniqueNickname();
      const agentExcluded = request.agent(app);
      const agentIncluded = request.agent(app);

      const excludedStart = await agentExcluded
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname: excludedNickname });
      await agentExcluded
        .post(`/api/practice/sessions/${excludedStart.body.data.sessionId}/complete`)
        .set("Content-Type", "application/json")
        .send({ clientElapsedMs: 1000 });

      await pool.query(
        `UPDATE practice_sessions SET ranking_eligible = false WHERE session_id = $1`,
        [excludedStart.body.data.sessionId],
      );

      const includedStart = await agentIncluded
        .post("/api/practice/sessions")
        .set("Content-Type", "application/json")
        .send({ mode: "practice", nickname: includedNickname });
      await agentIncluded
        .post(`/api/practice/sessions/${includedStart.body.data.sessionId}/complete`)
        .set("Content-Type", "application/json")
        .send({ clientElapsedMs: 5000 });

      const res = await request(app).get(
        "/api/rankings?mode=practice&period=daily&page=1&size=100",
      );
      expect(res.status).toBe(200);

      const rows = res.body.data as { nickname: string; is_verified: boolean }[];
      expect(rows.filter((r) => r.nickname === excludedNickname)).toHaveLength(0);

      const included = rows.filter((r) => r.nickname === includedNickname);
      expect(included).toHaveLength(1);
      // 게스트 세션이므로 is_verified = false
      expect(included[0].is_verified).toBe(false);
    });
  });

  // 리더보드는 상위 100명까지만 반환한다. 이 스위트는 공용 DB 의 기존 live_sessions
  // (부하 테스트 잔재 등)와 같은 기간을 공유하므로, 테스트 기록은 1~5ms 로 넣어
  // 상위권에 확실히 들어오게 한다. 라운드는 afterAll 에서 지워져 누적되지 않는다.
  describe("[6-2] 리더보드 표시명 = 최고기록 시점 닉네임 스냅샷", () => {
    const createdRoundIds: number[] = [];

    afterAll(async () => {
      await cleanupTestRounds(createdRoundIds);
      await cleanupTestGuests();
    });

    it("사후 개명해도 이미 낸 기록의 표시명은 안 바뀐다 (소급 사칭 차단)", async () => {
      const round = await createTestRound();
      createdRoundIds.push(round.roundId);

      const nicknameAtRecord = uniqueNickname();
      const impersonated = uniqueNickname();

      const agent = request.agent(app);
      const guestRes = await agent
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({ nickname: nicknameAtRecord });
      const guestUuid = guestRes.body.data.guestUuid;

      await insertTestSession({
        roundId: round.roundId,
        guestUuid,
        nickname: nicknameAtRecord,
        status: "completed",
        elapsedMs: 3,
      });

      // 회차 종료 후 닉네임만 교체 (guest_uuid 유지)
      await agent
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({ nickname: impersonated });

      const res = await request(app).get(
        "/api/rankings?mode=live&period=daily&page=1&size=100",
      );
      expect(res.status).toBe(200);

      const rows = res.body.data as { nickname: string; best_ms: number }[];
      expect(rows.find((r) => r.nickname === nicknameAtRecord)).toBeDefined();
      // 바꾼 이름이 과거 기록 행에 소급 적용되면 안 됨
      expect(rows.find((r) => r.nickname === impersonated)).toBeUndefined();
    });

    it("더 빠른 기록을 새 닉네임으로 내면 그때 표시명이 갱신된다", async () => {
      const roundOld = await createTestRound();
      const roundNew = await createTestRound();
      createdRoundIds.push(roundOld.roundId, roundNew.roundId);

      const oldNickname = uniqueNickname();
      const newNickname = uniqueNickname();

      const agent = request.agent(app);
      const guestRes = await agent
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({ nickname: oldNickname });
      const guestUuid = guestRes.body.data.guestUuid;

      await insertTestSession({
        roundId: roundOld.roundId,
        guestUuid,
        nickname: oldNickname,
        status: "completed",
        elapsedMs: 5,
      });
      // 개명 후 자기 최고기록을 실제로 깬 경우
      await insertTestSession({
        roundId: roundNew.roundId,
        guestUuid,
        nickname: newNickname,
        status: "completed",
        elapsedMs: 2,
      });

      const res = await request(app).get(
        "/api/rankings?mode=live&period=daily&page=1&size=100",
      );

      const rows = res.body.data as { nickname: string; best_ms: number }[];
      const mine = rows.find((r) => r.nickname === newNickname);
      expect(mine).toBeDefined();
      expect(mine!.best_ms).toBe(2);
      // identity 로 dedup 되므로 느린 기록은 별도 행으로 남지 않는다
      expect(rows.find((r) => r.nickname === oldNickname)).toBeUndefined();
    });
  });

  describe("[7] GET /api/rankings/me — 내 기록", () => {
    const createdRoundIds: number[] = [];

    afterAll(async () => {
      await cleanupTestLiveUsers();
      await cleanupTestRounds(createdRoundIds);
    });

    async function loginAgent(email: string, password: string) {
      const agent = request.agent(app);
      await agent
        .post("/api/auth/login")
        .set("Content-Type", "application/json")
        .send({ email, password });
      return agent;
    }

    it("본인의 완주 기록을 시도 단위로 전부 반환한다", async () => {
      const user = await createTestUser();
      const round1 = await createTestRound();
      const round2 = await createTestRound();
      createdRoundIds.push(round1.roundId, round2.roundId);

      await insertTestSession({
        roundId: round1.roundId,
        userId: user.userId,
        status: "completed",
        elapsedMs: 5000,
      });
      await insertTestSession({
        roundId: round2.roundId,
        userId: user.userId,
        status: "completed",
        elapsedMs: 9000,
      });

      const agent = await loginAgent(user.email, user.password);
      const res = await agent.get("/api/rankings/me?mode=live&period=daily");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.totalCount).toBe(2);

      const elapsed = res.body.data.map((r: { elapsed_ms: number }) => r.elapsed_ms).sort();
      expect(elapsed).toEqual([5000, 9000]);
      // best_ms 는 FE 호환 필드로 그 시도의 elapsed_ms 와 같은 값
      for (const row of res.body.data) {
        expect(row.best_ms).toBe(row.elapsed_ms);
        expect(row.is_verified).toBe(true);
      }
    });

    it("랭킹 상위권 밖 기록도 rank 와 함께 반환한다", async () => {
      const me = await createTestUser();
      const round = await createTestRound();
      createdRoundIds.push(round.roundId);

      // 나보다 빠른 참가자 3명
      for (let i = 1; i <= 3; i++) {
        const faster = await createTestUser();
        await insertTestSession({
          roundId: round.roundId,
          userId: faster.userId,
          status: "completed",
          elapsedMs: i * 100,
        });
      }
      await insertTestSession({
        roundId: round.roundId,
        userId: me.userId,
        status: "completed",
        elapsedMs: 90000,
      });

      const agent = await loginAgent(me.email, me.password);
      const res = await agent.get("/api/rankings/me?mode=live&period=daily");

      expect(res.status).toBe(200);
      const mine = res.body.data.find(
        (r: { elapsed_ms: number }) => r.elapsed_ms === 90000,
      );
      expect(mine).toBeDefined();
      // 나보다 빠른 사람이 최소 3명이므로 4위 이하. rank 는 number 여야 한다.
      expect(typeof mine.rank).toBe("number");
      expect(mine.rank).toBeGreaterThanOrEqual(4);
    });

    it("로그인도 게스트 쿠키도 없으면 200 + 빈 목록", async () => {
      const res = await request(app).get("/api/rankings/me?mode=live&period=daily");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.totalCount).toBe(0);
    });

    it("게스트도 닉네임을 바꾼 뒤 이전 닉네임으로 낸 시도까지 전부 조회된다", async () => {
      const roundA = await createTestRound();
      const roundB = await createTestRound();
      createdRoundIds.push(roundA.roundId, roundB.roundId);

      const firstNickname = uniqueNickname();
      const secondNickname = uniqueNickname();

      const agent = request.agent(app);
      const guestRes = await agent
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({ nickname: firstNickname });
      const guestUuid = guestRes.body.data.guestUuid;

      await insertTestSession({
        roundId: roundA.roundId,
        guestUuid,
        nickname: firstNickname,
        status: "completed",
        elapsedMs: 4000,
      });

      // 닉네임 변경 (guest_uuid 유지) 후, 이전 기록을 못 넘는 느린 시도를 추가
      await agent
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({ nickname: secondNickname });

      await insertTestSession({
        roundId: roundB.roundId,
        guestUuid,
        nickname: secondNickname,
        status: "completed",
        elapsedMs: 9000,
      });

      const res = await agent.get("/api/rankings/me?mode=live&period=daily");

      expect(res.status).toBe(200);
      expect(res.body.meta.totalCount).toBe(2);

      const rows = res.body.data as { elapsed_ms: number }[];
      // 닉네임이 아니라 identity 로 묶이므로 두 시도가 모두 남는다.
      expect(rows.map((r) => r.elapsed_ms).sort((a, b) => a - b)).toEqual([4000, 9000]);
      // 내 기록에는 닉네임을 싣지 않는다 (회원·게스트 공통).
      for (const row of rows) {
        expect(row).not.toHaveProperty("nickname");
      }

      // 반면 최고기록(=리더보드 표시)은 더 빠른 쪽이라 예전 닉네임 그대로다.
      const best = await agent.get("/api/rankings/me/best?mode=live&period=daily");
      expect(best.body.data.best_ms).toBe(4000);
      expect(best.body.data.nickname).toBe(firstNickname);
    });

    it("잘못된 period 는 422", async () => {
      const user = await createTestUser();
      const agent = await loginAgent(user.email, user.password);
      const res = await agent.get("/api/rankings/me?mode=live&period=yearly");
      expect(res.status).toBe(422);
    });

    it("mode=ticket 은 더 이상 지원하지 않는다 (422)", async () => {
      const res = await request(app).get("/api/rankings?mode=ticket&period=daily");
      expect(res.status).toBe(422);
    });
  });

  describe("[8] GET /api/rankings/me/best — 본인 최고기록 (게스트 포함, 인증 불필요)", () => {
    const createdRoundIds: number[] = [];

    afterAll(async () => {
      await cleanupTestLiveUsers();
      await cleanupTestRounds(createdRoundIds);
    });

    it("로그인 유저: 최고기록 1건 + 순위 반환", async () => {
      const user = await createTestUser();
      const round1 = await createTestRound();
      const round2 = await createTestRound();
      createdRoundIds.push(round1.roundId, round2.roundId);

      await insertTestSession({
        roundId: round1.roundId,
        userId: user.userId,
        status: "completed",
        elapsedMs: 4200,
      });
      await insertTestSession({
        roundId: round2.roundId,
        userId: user.userId,
        status: "completed",
        elapsedMs: 9000,
      });

      const agent = request.agent(app);
      await agent
        .post("/api/auth/login")
        .set("Content-Type", "application/json")
        .send({ email: user.email, password: user.password });

      const res = await agent.get("/api/rankings/me/best?mode=live&period=daily");

      expect(res.status).toBe(200);
      expect(res.body.data).not.toBeNull();
      // 개인 최고기록(더 빠른 쪽)만 반환
      expect(res.body.data.best_ms).toBe(4200);
      expect(res.body.data.is_verified).toBe(true);
      expect(typeof res.body.data.rank).toBe("number");
    });

    it("게스트: guest_uuid 쿠키로 식별, 닉네임은 최고기록 시점 스냅샷 (사후 개명 무효)", async () => {
      const round = await createTestRound();
      createdRoundIds.push(round.roundId);

      const nicknameAtSession = uniqueNickname();
      const renamedNickname = uniqueNickname();

      const agent = request.agent(app);
      const guestRes = await agent
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({ nickname: nicknameAtSession });
      const guestUuid = guestRes.body.data.guestUuid;

      await insertTestSession({
        roundId: round.roundId,
        guestUuid,
        nickname: nicknameAtSession,
        status: "completed",
        elapsedMs: 7000,
      });

      // 세션 생성 이후 닉네임 변경 (같은 guest_uuid 유지)
      await agent
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({ nickname: renamedNickname });

      const res = await agent.get("/api/rankings/me/best?mode=live&period=daily");

      expect(res.status).toBe(200);
      expect(res.body.data).not.toBeNull();
      expect(res.body.data.best_ms).toBe(7000);
      expect(res.body.data.is_verified).toBe(false);
      // 사후 개명은 이미 낸 기록의 표시명을 바꾸지 못한다 (소급 사칭 차단).
      expect(res.body.data.nickname).toBe(nicknameAtSession);
      expect(res.body.data.nickname).not.toBe(renamedNickname);
    });

    it("로그인도 게스트 쿠키도 없으면 data: null", async () => {
      const res = await request(app).get("/api/rankings/me/best?mode=live&period=daily");
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it("mode/period 누락 시 422", async () => {
      const res = await request(app).get("/api/rankings/me/best");
      expect(res.status).toBe(422);
    });

    // 리더보드 하단에 "내 순위"를 고정 행으로 띄우는 UI 를 위한 계약.
    // 두 API 가 rank 를 서로 다른 SQL 로 계산하므로(RANK() OVER vs COUNT(peers)+1),
    // 숫자가 어긋나면 목록의 N위와 고정 행의 N위가 안 맞는 버그가 된다.
    it("리더보드의 내 행과 rank·nickname·best_ms 가 일치한다", async () => {
      const round = await createTestRound();
      createdRoundIds.push(round.roundId);

      const myNickname = uniqueNickname();
      const agent = request.agent(app);
      const guestRes = await agent
        .post("/api/guests")
        .set("Content-Type", "application/json")
        .send({ nickname: myNickname });
      const guestUuid = guestRes.body.data.guestUuid;

      // 나보다 빠른 참가자 2명 + 나
      for (let i = 1; i <= 2; i++) {
        const faster = await createTestUser();
        await insertTestSession({
          roundId: round.roundId,
          userId: faster.userId,
          status: "completed",
          elapsedMs: i,
        });
      }
      await insertTestSession({
        roundId: round.roundId,
        guestUuid,
        nickname: myNickname,
        status: "completed",
        elapsedMs: 4,
      });

      const [board, mine] = await Promise.all([
        request(app).get("/api/rankings?mode=live&period=daily&page=1&size=100"),
        agent.get("/api/rankings/me/best?mode=live&period=daily"),
      ]);

      const myRow = (board.body.data as {
        rank: number;
        nickname: string;
        best_ms: number;
      }[]).find((r) => r.nickname === myNickname);

      expect(myRow).toBeDefined();
      expect(mine.body.data.rank).toBe(myRow!.rank);
      expect(mine.body.data.nickname).toBe(myRow!.nickname);
      expect(mine.body.data.best_ms).toBe(myRow!.best_ms);
    });
  });
});
