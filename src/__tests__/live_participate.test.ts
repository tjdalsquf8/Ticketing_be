/**
 * 실시간 티켓팅 참여 API 통합 테스트
 *
 * 테스트 대상:
 *   POST   /api/live/rounds/:roundId/sessions
 *   GET    /api/live/sessions/:sessionId/queue
 *   GET    /api/live/sessions/:sessionId/seats
 *   POST   /api/live/sessions/:sessionId/hold
 *   POST   /api/live/sessions/:sessionId/confirm
 */

import request from "supertest";
import app from "../app";
import pool from "../config/db";
import { v4 as uuidv4 } from "uuid";
import {
  createTestUser,
  createTestRound,
  insertTestSession,
  insertTestHold,
  expireHold,
  cleanupTestRounds,
  cleanupTestLiveUsers,
} from "./helpers/live.helper";
import { promoteQueuedSessions } from "../jobs/liveScheduler";
import config from "../config";

// ─── 전역 상태 ─────────────────────────────────────────────────────────────────

const createdRoundIds: number[] = [];

/** 로그인 agent + accessToken 쿠키를 갖는 supertest agent 반환 */
async function loginAgent(email: string, password: string) {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/login")
    .set("Content-Type", "application/json")
    .send({ email, password });
  return agent;
}

// ─── 정리 ──────────────────────────────────────────────────────────────────────

afterAll(async () => {
  await cleanupTestRounds(createdRoundIds);
  await cleanupTestLiveUsers();
});

// ─── 테스트 스위트 ─────────────────────────────────────────────────────────────

describe("Live Participate API", () => {
  // ─── [1] 세션 생성 ────────────────────────────────────────────────────────

  describe("[1] POST /api/live/rounds/:roundId/sessions — 세션 생성", () => {
    it("[1-1] 회원이 open 회차에 세션 생성 → 201, status active 또는 queued", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const { userId, email, password } = await createTestUser();
      const agent = await loginAgent(email, password);

      const res = await agent
        .post(`/api/live/rounds/${roundId}/sessions`)
        .set("Content-Type", "application/json")
        .send({ nickname: "tester" });

      expect(res.status).toBe(201);
      expect(res.body.data.sessionId).toBeDefined();
      expect(["active", "queued"]).toContain(res.body.data.status);

      // partial unique index: 같은 user_id + round_id 조합 검증
      const dbCheck = await pool.query(
        `SELECT COUNT(*) AS cnt FROM live_sessions WHERE round_id = $1 AND user_id = $2`,
        [roundId, userId],
      );
      expect(parseInt(dbCheck.rows[0].cnt, 10)).toBe(1);
    });

    it("[1-2] 게스트가 open 회차에 세션 생성 → 201, guest_uuid 쿠키 전달", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const guestUuid = uuidv4();

      const res = await request(app)
        .post(`/api/live/rounds/${roundId}/sessions`)
        .set("Content-Type", "application/json")
        .set("Cookie", `guest_uuid=${guestUuid}`)
        .send({ nickname: "guest_tester" });

      expect(res.status).toBe(201);
      expect(res.body.data.sessionId).toBeDefined();
      expect(["active", "queued"]).toContain(res.body.data.status);
    });

    it("[1-3] 같은 회원이 같은 회차 재요청 → 201, 동일 sessionId (idempotent)", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const { email, password } = await createTestUser();
      const agent = await loginAgent(email, password);

      const res1 = await agent
        .post(`/api/live/rounds/${roundId}/sessions`)
        .set("Content-Type", "application/json")
        .send({ nickname: "tester" });

      const res2 = await agent
        .post(`/api/live/rounds/${roundId}/sessions`)
        .set("Content-Type", "application/json")
        .send({ nickname: "tester" });

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.data.sessionId).toBe(res2.body.data.sessionId);
    });

    it("[1-4] draft 회차에 세션 생성 시도 → 409 ROUND_NOT_OPEN", async () => {
      // 'draft' 는 스키마에 없으므로 'scheduled' 로 대체 (open 이 아닌 상태)
      const { roundId } = await createTestRound({ status: "scheduled" });
      createdRoundIds.push(roundId);

      const guestUuid = uuidv4();

      const res = await request(app)
        .post(`/api/live/rounds/${roundId}/sessions`)
        .set("Content-Type", "application/json")
        .set("Cookie", `guest_uuid=${guestUuid}`)
        .send({ nickname: "tester" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ROUND_NOT_OPEN");
    });

    it("[1-N1] 회원이 body nickname 없이 세션 생성 → 201, user.name 사용됨", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const { name, email, password } = await createTestUser();
      const agent = await loginAgent(email, password);

      const res = await agent
        .post(`/api/live/rounds/${roundId}/sessions`)
        .set("Content-Type", "application/json")
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.data.sessionId).toBeDefined();

      // DB에서 nickname이 user.name으로 저장됐는지 확인
      const dbCheck = await pool.query(
        `SELECT nickname FROM live_sessions WHERE session_id = $1`,
        [res.body.data.sessionId],
      );
      expect(dbCheck.rows[0].nickname).toBe(name);
    });

    it("[1-N2] 회원이 body nickname 있으면 그 값 사용", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const { email, password } = await createTestUser();
      const agent = await loginAgent(email, password);

      const customNickname = "__tlv_custom_nick";
      const res = await agent
        .post(`/api/live/rounds/${roundId}/sessions`)
        .set("Content-Type", "application/json")
        .send({ nickname: customNickname });

      expect(res.status).toBe(201);

      const dbCheck = await pool.query(
        `SELECT nickname FROM live_sessions WHERE session_id = $1`,
        [res.body.data.sessionId],
      );
      expect(dbCheck.rows[0].nickname).toBe(customNickname);
    });

    it("[1-N3] 게스트가 body nickname 없이 세션 생성 → 400 NICKNAME_REQUIRED", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const guestUuid = uuidv4();

      const res = await request(app)
        .post(`/api/live/rounds/${roundId}/sessions`)
        .set("Content-Type", "application/json")
        .set("Cookie", `guest_uuid=${guestUuid}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("NICKNAME_REQUIRED");
    });

    it(`[1-5] 정원(ACTIVE_CAPACITY=${config.live.activeCapacity}) 초과 → queued 상태 + queue_position 부여`, async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      // config.live.activeCapacity 개의 active 세션을 미리 삽입해 정원 채우기
      const capacity = config.live.activeCapacity;
      for (let i = 0; i < capacity; i++) {
        await insertTestSession({
          roundId,
          guestUuid: uuidv4(),
          nickname: `filler_${i}`,
          status: "active",
        });
      }

      const { email, password } = await createTestUser();
      const agent = await loginAgent(email, password);

      const res = await agent
        .post(`/api/live/rounds/${roundId}/sessions`)
        .set("Content-Type", "application/json")
        .send({ nickname: "overflow_tester" });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("queued");
      expect(res.body.data.queuePosition).toBeGreaterThan(0);
    });
  });

  // ─── [2] 대기열 상태 조회 ────────────────────────────────────────────────

  describe("[2] GET /api/live/sessions/:sessionId/queue — 대기열 상태 조회", () => {
    it("[2-1] queued 세션 조회 후 앞 사람 promote 시 순번 감소 확인", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      // 정원을 가득 채운 뒤
      const capacity = config.live.activeCapacity;
      for (let i = 0; i < capacity; i++) {
        await insertTestSession({
          roundId,
          guestUuid: uuidv4(),
          nickname: `fill_${i}`,
          status: "active",
        });
      }

      // 대기열에 3명 삽입
      const queuedSessionIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { sessionId } = await insertTestSession({
          roundId,
          guestUuid: uuidv4(),
          nickname: `q_${i}`,
          status: "queued",
          queuePosition: i + 1,
        });
        queuedSessionIds.push(sessionId);
      }

      // 3번째 사람(queue_position=3) 의 현재 순번 조회
      const targetSession = queuedSessionIds[2]; // 마지막
      const { email: e3, password: p3 } = await createTestUser();
      const agent3 = await loginAgent(e3, p3);

      // 직접 세션 소유권이 없으므로 guest_uuid 방식으로 조회
      const guestUuid3 = uuidv4();
      const { sessionId: ownedSession } = await insertTestSession({
        roundId,
        guestUuid: guestUuid3,
        nickname: "q_owned",
        status: "queued",
        queuePosition: 4,
      });

      const resBefore = await request(app)
        .get(`/api/live/sessions/${ownedSession}/queue`)
        .set("Cookie", `guest_uuid=${guestUuid3}`);

      expect(resBefore.status).toBe(200);
      const posBefore = resBefore.body.data.queuePosition;
      expect(posBefore).toBeGreaterThan(0);

      // active 1개를 completed 로 전환 → 빈 슬롯 생성 후 promote 직접 호출
      await pool.query(
        `UPDATE live_sessions SET status = 'completed'
         WHERE id = (
           SELECT id FROM live_sessions
           WHERE round_id = $1 AND status = 'active'
           LIMIT 1
         )`,
        [roundId],
      );
      await promoteQueuedSessions();

      const resAfter = await request(app)
        .get(`/api/live/sessions/${ownedSession}/queue`)
        .set("Cookie", `guest_uuid=${guestUuid3}`);

      // 승격 또는 순번 감소
      expect(resAfter.status).toBe(200);
      const posAfter = resAfter.body.data.queuePosition;
      // ready=true (active 로 전환) 이거나 순번이 감소했어야 함
      const isPromoted = resAfter.body.data.ready === true;
      const isDecreased = posAfter !== null && posAfter < posBefore;
      expect(isPromoted || isDecreased).toBe(true);
    });
  });

  // ─── [3] 좌석 목록 조회 ──────────────────────────────────────────────────

  describe("[3] GET /api/live/sessions/:sessionId/seats — 좌석 목록 조회", () => {
    it("[3-1] active 세션은 좌석 목록 반환", async () => {
      const { roundId, seatLabels } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const guestUuid = uuidv4();
      const { sessionId } = await insertTestSession({
        roundId,
        guestUuid,
        nickname: "seat_getter",
        status: "active",
      });

      const res = await request(app)
        .get(`/api/live/sessions/${sessionId}/seats`)
        .set("Cookie", `guest_uuid=${guestUuid}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.seats)).toBe(true);
      expect(res.body.data.seats.length).toBe(seatLabels.length);
      expect(res.body.data.seats[0]).toHaveProperty("seatLabel");
      expect(res.body.data.seats[0]).toHaveProperty("status");
    });

    it("[3-2] queued 세션은 403 NOT_ACTIVE", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const guestUuid = uuidv4();
      const { sessionId } = await insertTestSession({
        roundId,
        guestUuid,
        nickname: "queued_getter",
        status: "queued",
        queuePosition: 1,
      });

      const res = await request(app)
        .get(`/api/live/sessions/${sessionId}/seats`)
        .set("Cookie", `guest_uuid=${guestUuid}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("NOT_ACTIVE");
    });
  });

  // ─── [4] 좌석 hold ──────────────────────────────────────────────────────

  describe("[4] POST /api/live/sessions/:sessionId/hold — 좌석 홀드", () => {
    it("[4-1] 정상 hold → 200, seatLabel + expiresAt 반환", async () => {
      const { roundId, seatLabels } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const guestUuid = uuidv4();
      const { sessionId } = await insertTestSession({
        roundId,
        guestUuid,
        nickname: "holder",
        status: "active",
      });

      const res = await request(app)
        .post(`/api/live/sessions/${sessionId}/hold`)
        .set("Content-Type", "application/json")
        .set("Cookie", `guest_uuid=${guestUuid}`)
        .send({ seatLabel: seatLabels[0] });

      expect(res.status).toBe(200);
      expect(res.body.data.seatLabel).toBe(seatLabels[0]);
      expect(res.body.data.expiresAt).toBeDefined();

      // DB 확인: 좌석이 held 로 바뀌었는지
      const dbSeat = await pool.query(
        `SELECT status FROM live_seats WHERE round_id = $1 AND seat_label = $2`,
        [roundId, seatLabels[0]],
      );
      expect(dbSeat.rows[0].status).toBe("held");
    });

    it("[4-2] 이미 held 좌석 재시도 → 409 SEAT_ALREADY_HELD", async () => {
      const { roundId, seatLabels } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      // 다른 게스트가 먼저 hold
      const otherGuest = uuidv4();
      const { sessionId: otherSession } = await insertTestSession({
        roundId,
        guestUuid: otherGuest,
        nickname: "other_holder",
        status: "active",
      });
      await request(app)
        .post(`/api/live/sessions/${otherSession}/hold`)
        .set("Content-Type", "application/json")
        .set("Cookie", `guest_uuid=${otherGuest}`)
        .send({ seatLabel: seatLabels[0] });

      // 내 세션으로 같은 좌석 hold 시도
      const myGuest = uuidv4();
      const { sessionId: mySession } = await insertTestSession({
        roundId,
        guestUuid: myGuest,
        nickname: "conflict_holder",
        status: "active",
      });

      const res = await request(app)
        .post(`/api/live/sessions/${mySession}/hold`)
        .set("Content-Type", "application/json")
        .set("Cookie", `guest_uuid=${myGuest}`)
        .send({ seatLabel: seatLabels[0] });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SEAT_ALREADY_HELD");
    });

    it("[4-3] 본인이 다른 좌석 hold → 기존 hold 자동 해제 후 새 좌석 hold", async () => {
      const { roundId, seatLabels } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const guestUuid = uuidv4();
      const { sessionId } = await insertTestSession({
        roundId,
        guestUuid,
        nickname: "swapper",
        status: "active",
      });

      // 첫 번째 좌석 hold
      await request(app)
        .post(`/api/live/sessions/${sessionId}/hold`)
        .set("Content-Type", "application/json")
        .set("Cookie", `guest_uuid=${guestUuid}`)
        .send({ seatLabel: seatLabels[0] });

      // 두 번째 좌석으로 교체
      const res = await request(app)
        .post(`/api/live/sessions/${sessionId}/hold`)
        .set("Content-Type", "application/json")
        .set("Cookie", `guest_uuid=${guestUuid}`)
        .send({ seatLabel: seatLabels[1] });

      expect(res.status).toBe(200);
      expect(res.body.data.seatLabel).toBe(seatLabels[1]);

      // 첫 번째 좌석은 available 로 복구
      const oldSeat = await pool.query(
        `SELECT status FROM live_seats WHERE round_id = $1 AND seat_label = $2`,
        [roundId, seatLabels[0]],
      );
      expect(oldSeat.rows[0].status).toBe("available");

      // 두 번째 좌석은 held
      const newSeat = await pool.query(
        `SELECT status FROM live_seats WHERE round_id = $1 AND seat_label = $2`,
        [roundId, seatLabels[1]],
      );
      expect(newSeat.rows[0].status).toBe("held");
    });
  });

  // ─── [5] 좌석 확정 ──────────────────────────────────────────────────────

  describe("[5] POST /api/live/sessions/:sessionId/confirm — 좌석 확정", () => {
    it("[5-1] 회원 + rank ≤ 10 → 티켓 발급 (ticketId 반환)", async () => {
      const { roundId, seatLabels } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const { userId, email, password } = await createTestUser();
      const agent = await loginAgent(email, password);

      // 세션 생성
      const createRes = await agent
        .post(`/api/live/rounds/${roundId}/sessions`)
        .set("Content-Type", "application/json")
        .send({ nickname: "ticket_buyer" });

      const { sessionId } = createRes.body.data;

      // hold
      await agent
        .post(`/api/live/sessions/${sessionId}/hold`)
        .set("Content-Type", "application/json")
        .send({ seatLabel: seatLabels[0] });

      // confirm
      const res = await agent
        .post(`/api/live/sessions/${sessionId}/confirm`)
        .set("Content-Type", "application/json")
        .send({ seatLabel: seatLabels[0] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.rankNumber).toBeGreaterThan(0);
      expect(res.body.data.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(res.body.data.ticketId).not.toBeNull();
      expect(typeof res.body.data.ticketId).toBe("number");

      // tickets 테이블 확인
      const ticket = await pool.query(
        `SELECT * FROM tickets WHERE id = $1`,
        [res.body.data.ticketId],
      );
      expect(ticket.rows.length).toBe(1);
      expect(ticket.rows[0].user_id).toBe(userId);

      // 티켓 발급 시 보유 티켓 잔액 +1
      const userRow = await pool.query(`SELECT tickets FROM users WHERE id = $1`, [userId]);
      expect(userRow.rows[0].tickets).toBe(1);
    });

    it("[5-2] 게스트 → ticketId: null", async () => {
      const { roundId, seatLabels } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const guestUuid = uuidv4();

      // 세션 생성
      const createRes = await request(app)
        .post(`/api/live/rounds/${roundId}/sessions`)
        .set("Content-Type", "application/json")
        .set("Cookie", `guest_uuid=${guestUuid}`)
        .send({ nickname: "guest_buyer" });

      const { sessionId } = createRes.body.data;

      // hold
      await request(app)
        .post(`/api/live/sessions/${sessionId}/hold`)
        .set("Content-Type", "application/json")
        .set("Cookie", `guest_uuid=${guestUuid}`)
        .send({ seatLabel: seatLabels[0] });

      // confirm
      const res = await request(app)
        .post(`/api/live/sessions/${sessionId}/confirm`)
        .set("Content-Type", "application/json")
        .set("Cookie", `guest_uuid=${guestUuid}`)
        .send({ seatLabel: seatLabels[0] });

      expect(res.status).toBe(200);
      expect(res.body.data.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(res.body.data.ticketId).toBeNull();
    });

    it("[5-3] 만료된 hold → 409 HOLD_EXPIRED", async () => {
      const { roundId, seatLabels } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const guestUuid = uuidv4();
      const { sessionId } = await insertTestSession({
        roundId,
        guestUuid,
        nickname: "expired_holder",
        status: "active",
      });

      // hold 삽입 후 즉시 만료
      const actorKey = `guest:${guestUuid}`;
      await insertTestHold({
        roundId,
        seatLabel: seatLabels[0],
        actorKey,
        ttlSeconds: 30,
      });
      await expireHold(actorKey, roundId);

      const res = await request(app)
        .post(`/api/live/sessions/${sessionId}/confirm`)
        .set("Content-Type", "application/json")
        .set("Cookie", `guest_uuid=${guestUuid}`)
        .send({ seatLabel: seatLabels[0] });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("HOLD_EXPIRED");
    });
  });
});
