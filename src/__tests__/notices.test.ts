/**
 * 공지사항 API 통합 테스트
 *
 * GET    /api/notices               (공개 목록)
 * GET    /api/notices/:id           (공개 상세)
 * GET    /api/admin/notices         (관리자)
 * POST   /api/admin/notices
 * PATCH  /api/admin/notices/:id
 * DELETE /api/admin/notices/:id
 */

import request from "supertest";
import app from "../app";
import pool from "../config/db";
import {
  createAdminUser,
  createTestUser,
  cleanupTestEvUsers,
  type TestUserResult,
} from "./helpers/events.helper";

let admin: TestUserResult;
let adminAgent: ReturnType<typeof request.agent>;
let normalUser: TestUserResult;
let normalAgent: ReturnType<typeof request.agent>;

const createdNoticeIds: number[] = [];

async function loginAgent(email: string, password: string) {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/login")
    .set("Content-Type", "application/json")
    .send({ email, password });
  return agent;
}

describe("Notices API", () => {
  beforeAll(async () => {
    admin = await createAdminUser();
    adminAgent = await loginAgent(admin.email, admin.password);
    normalUser = await createTestUser();
    normalAgent = await loginAgent(normalUser.email, normalUser.password);
  });

  afterAll(async () => {
    if (createdNoticeIds.length > 0) {
      await pool.query(`DELETE FROM notices WHERE id = ANY($1::int[])`, [
        createdNoticeIds,
      ]);
    }
    await cleanupTestEvUsers();
  });

  it("일반 유저는 공지사항을 생성할 수 없다 (403)", async () => {
    const res = await normalAgent
      .post("/api/admin/notices")
      .set("Content-Type", "application/json")
      .send({ kind: "notice", title: "권한 없음 테스트" });
    expect(res.status).toBe(403);
  });

  it("관리자가 공지사항을 생성하면 즉시 공개 목록/상세에 노출된다", async () => {
    const createRes = await adminAgent
      .post("/api/admin/notices")
      .set("Content-Type", "application/json")
      .send({ kind: "update", title: "신규 기능 출시", content: "상세 내용입니다." });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.kind).toBe("update");
    expect(createRes.body.data.title).toBe("신규 기능 출시");
    expect(createRes.body.data.content).toBe("상세 내용입니다.");
    expect(createRes.body.data.href).toBeUndefined();
    const noticeId = createRes.body.data.id;
    createdNoticeIds.push(noticeId);

    const publicListRes = await request(app).get("/api/notices?limit=20");
    expect(publicListRes.status).toBe(200);
    const match = publicListRes.body.data.find((n: { id: number }) => n.id === noticeId);
    expect(match).toBeDefined();
    expect(match.kind).toBe("update");
    expect(match.content).toBeUndefined();
    expect(match.href).toBeUndefined();

    const publicDetailRes = await request(app).get(`/api/notices/${noticeId}`);
    expect(publicDetailRes.status).toBe(200);
    expect(publicDetailRes.body.data.title).toBe("신규 기능 출시");
    expect(publicDetailRes.body.data.content).toBe("상세 내용입니다.");
  });

  it("존재하지 않는 공지 상세 조회는 404를 반환한다", async () => {
    const res = await request(app).get("/api/notices/999999999");
    expect(res.status).toBe(404);
  });

  it("관리자 목록 조회는 content 와 totalCount 를 포함한다", async () => {
    const res = await adminAgent.get("/api/admin/notices?page=1&limit=50");
    expect(res.status).toBe(200);
    expect(typeof res.body.meta.totalCount).toBe("number");
    expect(res.body.meta.totalCount).toBeGreaterThanOrEqual(createdNoticeIds.length);
    const match = res.body.data.find((n: { id: number }) => n.id === createdNoticeIds[0]);
    expect(match.content).toBe("상세 내용입니다.");
  });

  it("관리자가 공지사항을 수정할 수 있다", async () => {
    const createRes = await adminAgent
      .post("/api/admin/notices")
      .set("Content-Type", "application/json")
      .send({ kind: "fix", title: "버그 수정 전" });
    const noticeId = createRes.body.data.id;
    createdNoticeIds.push(noticeId);

    const patchRes = await adminAgent
      .patch(`/api/admin/notices/${noticeId}`)
      .set("Content-Type", "application/json")
      .send({ title: "버그 수정 완료", content: "수정된 내용" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.title).toBe("버그 수정 완료");
    expect(patchRes.body.data.content).toBe("수정된 내용");
    expect(patchRes.body.data.kind).toBe("fix");
  });

  it("관리자가 공지사항을 삭제하면 공개 목록에서도 사라진다", async () => {
    const createRes = await adminAgent
      .post("/api/admin/notices")
      .set("Content-Type", "application/json")
      .send({ kind: "notice", title: "삭제될 공지" });
    const noticeId = createRes.body.data.id;

    const deleteRes = await adminAgent.delete(`/api/admin/notices/${noticeId}`);
    expect(deleteRes.status).toBe(200);

    const publicRes = await request(app).get("/api/notices");
    const match = publicRes.body.data.find((n: { id: number }) => n.id === noticeId);
    expect(match).toBeUndefined();
  });

  it("존재하지 않는 id 수정/삭제는 404를 반환한다", async () => {
    const patchRes = await adminAgent
      .patch("/api/admin/notices/999999999")
      .set("Content-Type", "application/json")
      .send({ title: "없음" });
    expect(patchRes.status).toBe(404);

    const deleteRes = await adminAgent.delete("/api/admin/notices/999999999");
    expect(deleteRes.status).toBe(404);
  });

  it("공개 조회 응답에 브라우저 캐시 헤더가 붙는다", async () => {
    const listRes = await request(app).get("/api/notices?limit=20");
    expect(listRes.headers["cache-control"]).toBe("public, max-age=60");

    const detailRes = await request(app).get(`/api/notices/${createdNoticeIds[0]}`);
    expect(detailRes.headers["cache-control"]).toBe("public, max-age=60");
  });

  it("TTL 캐시 범위 내 요청은 이후 삽입을 즉시 반영하지 않는다", async () => {
    // limit 별로 캐시 키가 갈리므로 다른 테스트가 안 쓴 limit 으로 캐시를 채운다.
    const before = await request(app).get("/api/notices?limit=7");
    expect(before.status).toBe(200);

    // 서비스 계층을 우회해 DB 에 직접 넣으면 무효화가 일어나지 않는다 → 캐시가 살아있는지 확인.
    const inserted = await pool.query(
      `INSERT INTO notices (kind, title, created_by) VALUES ($1, $2, $3) RETURNING id`,
      ["fix", "캐시 검증용 공지", admin.userId],
    );
    const noticeId = inserted.rows[0].id as number;
    createdNoticeIds.push(noticeId);

    const after = await request(app).get("/api/notices?limit=7");
    const match = after.body.data.find((n: { id: number }) => n.id === noticeId);
    expect(match).toBeUndefined();
  });
});

afterAll(async () => {
  await pool.end();
});
