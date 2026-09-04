/**
 * 회차 내 게스트 닉네임 중복 사전 차단 (POST /api/live/rounds/:roundId/sessions)
 *
 * - 같은 회차에서 다른 게스트가 이미 쓰는 닉네임이면 409 NICKNAME_TAKEN_IN_ROUND
 * - 스코프는 회차(round) 단위 — 다른 회차에서는 재사용 가능
 * - 같은 게스트의 재요청(동일 닉네임)은 기존 세션을 그대로 반환 (차단 아님)
 * - 회원 닉네임은 대상 아님 (게스트만 검사)
 */

import request from "supertest";
import app from "../app";
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

describe("회차 내 게스트 닉네임 중복 차단", () => {
  afterAll(async () => {
    await cleanupTestLiveUsers();
    await cleanupTestRounds(createdRoundIds);
  });

  it("다른 게스트가 같은 회차에서 이미 쓰는 닉네임이면 409를 반환한다", async () => {
    const round = await createTestRound();
    createdRoundIds.push(round.roundId);
    const nickname = `dup_${Date.now()}`;

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
    expect(secondRes.status).toBe(409);
    expect(secondRes.body.error.code).toBe("NICKNAME_TAKEN_IN_ROUND");
  });

  it("다른 회차에서는 같은 닉네임을 재사용할 수 있다", async () => {
    const roundX = await createTestRound();
    const roundY = await createTestRound();
    createdRoundIds.push(roundX.roundId, roundY.roundId);
    const nickname = `scope_${Date.now()}`;

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

  it("같은 게스트가 재요청하면 차단 없이 기존 세션을 반환한다", async () => {
    const round = await createTestRound();
    createdRoundIds.push(round.roundId);
    const nickname = `retry_${Date.now()}`;

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

  it("회원 닉네임은 게스트 닉네임과 겹쳐도 차단되지 않는다", async () => {
    const round = await createTestRound();
    createdRoundIds.push(round.roundId);
    const nickname = `member_${Date.now()}`;

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
