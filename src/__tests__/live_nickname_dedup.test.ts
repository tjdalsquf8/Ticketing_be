/**
 * 회차 내 게스트 닉네임 중복 허용 (POST /api/live/rounds/:roundId/sessions)
 *
 * - 같은 회차에서 다른 게스트가 이미 쓰는 닉네임이어도 참여할 수 있다 (201)
 *   · 신원은 guest_uuid 로 구분되고, 본인 기록·등수는 자기 세션 기준으로 조회된다
 *   · 회귀 방지: 예전에는 409 NICKNAME_TAKEN_IN_ROUND 로 거절했고,
 *     uq_live_sessions_round_nickname_guest 유니크 인덱스가 이를 강제했다
 * - 같은 게스트의 재요청(동일 닉네임)은 기존 세션을 그대로 반환 (중복 참여 방지)
 * - 회원 닉네임도 게스트 닉네임과 겹칠 수 있다
 */

import request from "supertest";
import app from "../app";
import pool from "../config/db";
import {
  createTestUser,
  createTestRound,
  cleanupTestRounds,
  cleanupTestLiveUsers,
} from "./helpers/live.helper";

const createdRoundIds: number[] = [];

async function loginAgent(email: string, password: string) {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/login")
    .set("Content-Type", "application/json")
    .send({ email, password });
  return agent;
}

// 닉네임은 2~10자 제한이 있어 Date.now() 를 그대로 붙이면 길이를 넘긴다.
// base36 하위 6자리면 테스트 실행 간 충돌 없이 접두어와 합쳐 10자 안에 들어온다.
const uniqueSuffix = () => Date.now().toString(36).slice(-6);

describe("회차 내 게스트 닉네임 중복 허용", () => {
  afterAll(async () => {
    await cleanupTestLiveUsers();
    await cleanupTestRounds(createdRoundIds);
  });

  it("다른 게스트가 같은 회차에서 이미 쓰는 닉네임이어도 참여할 수 있다", async () => {
    const round = await createTestRound();
    createdRoundIds.push(round.roundId);
    const nickname = `dup${uniqueSuffix()}`;

    const guestA = request.agent(app);
    await guestA.post("/api/guests").set("Content-Type", "application/json").send({});

    const firstRes = await guestA
      .post(`/api/live/rounds/${round.roundId}/sessions`)
      .set("Content-Type", "application/json")
      .send({ nickname });
    expect(firstRes.status).toBe(201);

    const guestB = request.agent(app);
    await guestB.post("/api/guests").set("Content-Type", "application/json").send({});

    const secondRes = await guestB
      .post(`/api/live/rounds/${round.roundId}/sessions`)
      .set("Content-Type", "application/json")
      .send({ nickname });
    expect(secondRes.status).toBe(201);
    // 별개의 세션이어야 한다 (같은 게스트로 합쳐지면 안 됨)
    expect(secondRes.body.data.sessionId).not.toBe(firstRes.body.data.sessionId);
  });

  it("다른 회차에서도 같은 닉네임을 쓸 수 있다", async () => {
    const roundX = await createTestRound();
    const roundY = await createTestRound();
    createdRoundIds.push(roundX.roundId, roundY.roundId);
    const nickname = `scp${uniqueSuffix()}`;

    const guestA = request.agent(app);
    await guestA.post("/api/guests").set("Content-Type", "application/json").send({});
    const resX = await guestA
      .post(`/api/live/rounds/${roundX.roundId}/sessions`)
      .set("Content-Type", "application/json")
      .send({ nickname });
    expect(resX.status).toBe(201);

    const guestB = request.agent(app);
    await guestB.post("/api/guests").set("Content-Type", "application/json").send({});
    const resY = await guestB
      .post(`/api/live/rounds/${roundY.roundId}/sessions`)
      .set("Content-Type", "application/json")
      .send({ nickname });
    expect(resY.status).toBe(201);
  });

  it("같은 게스트가 재요청하면 기존 세션을 그대로 반환한다", async () => {
    const round = await createTestRound();
    createdRoundIds.push(round.roundId);
    const nickname = `rty${uniqueSuffix()}`;

    const guest = request.agent(app);
    await guest.post("/api/guests").set("Content-Type", "application/json").send({});

    const firstRes = await guest
      .post(`/api/live/rounds/${round.roundId}/sessions`)
      .set("Content-Type", "application/json")
      .send({ nickname });
    expect(firstRes.status).toBe(201);

    const secondRes = await guest
      .post(`/api/live/rounds/${round.roundId}/sessions`)
      .set("Content-Type", "application/json")
      .send({ nickname });
    expect(secondRes.status).toBe(201);
    expect(secondRes.body.data.sessionId).toBe(firstRes.body.data.sessionId);
  });

  it("회원 닉네임도 게스트 닉네임과 겹칠 수 있다", async () => {
    const round = await createTestRound();
    createdRoundIds.push(round.roundId);
    const nickname = `mbr${uniqueSuffix()}`;

    const guest = request.agent(app);
    await guest.post("/api/guests").set("Content-Type", "application/json").send({});
    const guestRes = await guest
      .post(`/api/live/rounds/${round.roundId}/sessions`)
      .set("Content-Type", "application/json")
      .send({ nickname });
    expect(guestRes.status).toBe(201);

    const member = await createTestUser();
    const memberAgent = await loginAgent(member.email, member.password);
    const memberRes = await memberAgent
      .post(`/api/live/rounds/${round.roundId}/sessions`)
      .set("Content-Type", "application/json")
      .send({ nickname });
    expect(memberRes.status).toBe(201);
  });
});

afterAll(async () => {
  await pool.end();
});
