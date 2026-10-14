/**
 * 실시간 티켓팅 참여 API 통합 테스트
 *
 * 테스트 대상:
 *   POST   /api/live/rounds/:roundId/sessions
 *   GET    /api/live/rounds/:roundId/queue/stream
 *   GET    /api/live/rounds/:roundId/seats/stream
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
import { readSseEvent, openSseStream } from "./helpers/sse.helper";
import { promoteQueuedSessions } from "../jobs/liveScheduler";
import config from "../config";
import * as liveSession from "../services/live_session.redis";
import * as liveQueue from "../services/live_queue.redis";
import * as liveActive from "../services/live_active.redis";
import * as liveSeatLock from "../services/live_seat_lock.redis";
import { insertRedisLiveSession, insertRedisSeatHold, testActorKey } from "./helpers/live.helper";

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
  await pool.end();
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

      // 중복 참여 방지 검증: Redis dedup 포인터가 방금 생성된 sessionId를 정확히 가리키는지
      // (queued/active 세션은 Postgres에 안 쓰이므로 partial unique index 대신 여기서 확인)
      const dedupSessionId = await liveSession.findExistingSessionId(roundId, userId, null);
      expect(dedupSessionId).toBe(res.body.data.sessionId);
    });

    it("[1-2] 게스트가 open 회차에 세션 생성 → 201, guest_uuid 쿠키 전달", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const guestUuid = uuidv4();

      const res = await request(app)
        .post(`/api/live/rounds/${roundId}/sessions`)
        .set("Content-Type", "application/json")
        .set("Cookie", `guest_uuid=${guestUuid}`)
        .send({ nickname: "guest_test" });

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

      // 세션은 queued/active 동안 Redis에 있다 (Postgres는 confirm 시점에만 쓴다)
      const record = await liveSession.getSessionRecord(res.body.data.sessionId);
      expect(record?.nickname).toBe(name);
    });

    it("[1-N2] 회원이 body nickname 있으면 그 값 사용", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const { email, password } = await createTestUser();
      const agent = await loginAgent(email, password);

      const customNickname = "__tlv_cust";
      const res = await agent
        .post(`/api/live/rounds/${roundId}/sessions`)
        .set("Content-Type", "application/json")
        .send({ nickname: customNickname });

      expect(res.status).toBe(201);

      const record = await liveSession.getSessionRecord(res.body.data.sessionId);
      expect(record?.nickname).toBe(customNickname);
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

      // 정원 체크는 이제 Redis 활성 집합(SCARD) 기준이므로 거기에 직접 채운다.
      const capacity = config.live.activeCapacity;
      for (let i = 0; i < capacity; i++) {
        await insertRedisLiveSession({
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
        .send({ nickname: "overflow" });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("queued");
      expect(res.body.data.queuePosition).toBeGreaterThan(0);
    });
  });

  // ─── [2] 대기열 SSE 스트림 ───────────────────────────────────────────────

  describe("[2] GET /api/live/rounds/:roundId/queue/stream — 대기열 순번 SSE 스트림", () => {
    it("[2-1] snapshot 수신 후 앞 사람 promote 시 push 로 순번 감소 확인", async () => {
      const { roundId } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      // 정원을 가득 채운 뒤 (Redis 활성 집합)
      const capacity = config.live.activeCapacity;
      const fillerSessionIds: string[] = [];
      for (let i = 0; i < capacity; i++) {
        const { sessionId } = await insertRedisLiveSession({
          roundId,
          guestUuid: uuidv4(),
          nickname: `fill_${i}`,
          status: "active",
        });
        fillerSessionIds.push(sessionId);
      }

      // 대기열에 3명 삽입 (내 앞사람들, Redis ZSET)
      for (let i = 0; i < 3; i++) {
        await insertRedisLiveSession({
          roundId,
          guestUuid: uuidv4(),
          nickname: `q_${i}`,
          status: "queued",
        });
      }

      const guestUuid3 = uuidv4();
      const { sessionId: ownedSession } = await insertRedisLiveSession({
        roundId,
        guestUuid: guestUuid3,
        nickname: "q_owned",
        status: "queued",
      });

      const stream = openSseStream(
        app,
        `/api/live/rounds/${roundId}/queue/stream?sessionId=${ownedSession}`,
        { Cookie: `guest_uuid=${guestUuid3}` },
      );

      try {
        const snapshot = await stream.next();
        expect(snapshot.status).toBe(200);
        expect(snapshot.event).toBe("snapshot");
        const before = snapshot.data as { queuePosition: number | null; ready: boolean };
        expect(before.queuePosition).toBeGreaterThan(0);
        const posBefore = before.queuePosition as number;

        // active 1개를 "완료"시켜 빈 슬롯 생성 (confirm이 하는 것과 같은 Redis 정리) 후 promote 직접 호출
        const freedSessionId = fillerSessionIds[0];
        await liveActive.leaveActive(roundId, freedSessionId);
        await promoteQueuedSessions();

        // 연결을 유지한 채로 push 되는 다음 이벤트를 기다린다 (폴링 재요청이 아님)
        const update = await stream.next();
        expect(update.event).toBe("queue_update");
        const after = update.data as { queuePosition: number | null; ready: boolean };

        const isPromoted = after.ready === true;
        const isDecreased = after.queuePosition !== null && after.queuePosition < posBefore;
        expect(isPromoted || isDecreased).toBe(true);
      } finally {
        stream.close();
      }
    });
  });

  // ─── [3] 좌석 SSE 스트림 ─────────────────────────────────────────────────

  describe("[3] GET /api/live/rounds/:roundId/seats/stream — 좌석 SSE 스트림", () => {
    it("[3-1] active 세션은 최초 snapshot 이벤트로 좌석 목록 반환", async () => {
      const { roundId, seatLabels } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const guestUuid = uuidv4();
      const { sessionId } = await insertTestSession({
        roundId,
        guestUuid,
        nickname: "seat_getter",
        status: "active",
      });

      const { status, event, data } = await readSseEvent(
        app,
        `/api/live/rounds/${roundId}/seats/stream?sessionId=${sessionId}`,
        { Cookie: `guest_uuid=${guestUuid}` },
      );

      expect(status).toBe(200);
      expect(event).toBe("snapshot");
      const seatsData = data as { seats: Array<{ seatLabel: string; status: string }> };
      expect(Array.isArray(seatsData.seats)).toBe(true);
      expect(seatsData.seats.length).toBe(seatLabels.length);
      expect(seatsData.seats[0]).toHaveProperty("seatLabel");
      expect(seatsData.seats[0]).toHaveProperty("status");
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

      const { status, body } = await readSseEvent(
        app,
        `/api/live/rounds/${roundId}/seats/stream?sessionId=${sessionId}`,
        { Cookie: `guest_uuid=${guestUuid}` },
      );

      expect(status).toBe(403);
      expect((body as { error: { code: string } }).error.code).toBe("NOT_ACTIVE");
    });

    it("[3-3] 다른 회차 소속 sessionId 로 접근 → 404 SESSION_NOT_FOUND", async () => {
      const { roundId: roundA } = await createTestRound({ status: "open" });
      const { roundId: roundB } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundA, roundB);

      const guestUuid = uuidv4();
      const { sessionId } = await insertTestSession({
        roundId: roundA,
        guestUuid,
        nickname: "scope_checker",
        status: "active",
      });

      const { status, body } = await readSseEvent(
        app,
        `/api/live/rounds/${roundB}/seats/stream?sessionId=${sessionId}`,
        { Cookie: `guest_uuid=${guestUuid}` },
      );

      expect(status).toBe(404);
      expect((body as { error: { code: string } }).error.code).toBe("SESSION_NOT_FOUND");
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

      // hold 상태는 이제 Redis가 관리한다 (Postgres live_seats는 sold만 반영)
      const myHold = await liveSeatLock.getMyHold(roundId, testActorKey({ guestUuid }));
      expect(myHold?.seatLabel).toBe(seatLabels[0]);
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

      // hold 상태는 Redis 기준 — 첫 번째 좌석은 자동 해제, 두 번째만 남아있어야 함
      const heldLabels = await liveSeatLock.scanHeldLabels(roundId);
      expect(heldLabels.has(seatLabels[0])).toBe(false);
      expect(heldLabels.has(seatLabels[1])).toBe(true);

      const myHold = await liveSeatLock.getMyHold(roundId, testActorKey({ guestUuid }));
      expect(myHold?.seatLabel).toBe(seatLabels[1]);
    });
  });

  // ─── [5] 좌석 확정 ──────────────────────────────────────────────────────

  describe("[5] POST /api/live/sessions/:sessionId/confirm — 좌석 확정", () => {
    it("[5-1] 회원 완주 → rankNumber 반환, ticketId 없음", async () => {
      const { roundId, seatLabels } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const { userId, email, password } = await createTestUser();
      const agent = await loginAgent(email, password);

      // 세션 생성
      const createRes = await agent
        .post(`/api/live/rounds/${roundId}/sessions`)
        .set("Content-Type", "application/json")
        .send({ nickname: "seat_buyer" });

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
      // 티켓 개념이 제거되어 발급물이 없다
      expect(res.body.data.ticketId).toBeUndefined();

      // 완주 세션은 기록으로 남는다
      const sessionRow = await pool.query(
        `SELECT status, elapsed_ms FROM live_sessions
         WHERE round_id = $1 AND user_id = $2`,
        [roundId, userId],
      );
      expect(sessionRow.rows.length).toBe(1);
      expect(sessionRow.rows[0].status).toBe("completed");
    });

    it("[5-2] 게스트도 좌석 확정 가능 (발급물 없음)", async () => {
      const { roundId, seatLabels } = await createTestRound({ status: "open" });
      createdRoundIds.push(roundId);

      const guestUuid = uuidv4();

      // 세션 생성
      const createRes = await request(app)
        .post(`/api/live/rounds/${roundId}/sessions`)
        .set("Content-Type", "application/json")
        .set("Cookie", `guest_uuid=${guestUuid}`)
        .send({ nickname: "g_buyer" });

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
      expect(res.body.data.ticketId).toBeUndefined();
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
