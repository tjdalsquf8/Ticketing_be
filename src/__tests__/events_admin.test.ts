/**
 * 관리자 이벤트 API 통합 테스트
 *
 * GET    /api/admin/venues
 * POST   /api/admin/events
 * POST   /api/admin/event-series
 * PATCH  /api/admin/events/:eventId
 * POST   /api/admin/events/:eventId/cancel
 * POST   /api/admin/event-series/:seriesId/cancel
 * GET    /api/admin/events/:eventId/registrations
 */

import request from "supertest";
import app from "../app";
import pool from "../config/db";
import {
  createAdminUser,
  createTestUser,
  createTestEvent,
  createTestRegistration,
  cleanupTestEvents,
  cleanupTestSeries,
  cleanupTestEvUsers,
  DEFAULT_VENUE_SLUG,
  type TestUserResult,
} from "./helpers/events.helper";

// ─── 전역 상태 ─────────────────────────────────────────────────────────────────

let admin: TestUserResult;
let adminAgent: ReturnType<typeof request.agent>;
let normalUser: TestUserResult;
let normalAgent: ReturnType<typeof request.agent>;

const createdEventIds: number[] = [];
const createdSeriesIds: number[] = [];

async function loginAgent(email: string, password: string) {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/login")
    .set("Content-Type", "application/json")
    .send({ email, password });
  return agent;
}

/** 현재 시각 기준 N분 후 ISO 문자열 */
function futureISO(plusMinutes: number): string {
  return new Date(Date.now() + plusMinutes * 60 * 1000).toISOString();
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await cleanupTestEvUsers();
  admin      = await createAdminUser();
  normalUser = await createTestUser();
  adminAgent  = await loginAgent(admin.email, admin.password);
  normalAgent = await loginAgent(normalUser.email, normalUser.password);
});

afterAll(async () => {
  await cleanupTestEvents(createdEventIds);
  await cleanupTestSeries(createdSeriesIds);
  await cleanupTestEvUsers();
});

// ─── 테스트 스위트 ─────────────────────────────────────────────────────────────

describe("Events Admin API", () => {

  // ─── [1] GET /api/admin/venues ───────────────────────────────────────────────

  describe("[1] GET /api/admin/venues — 공연장 목록", () => {
    it("[1-1] 10개 반환 + venueId가 slug 문자열", async () => {
      const res = await adminAgent.get("/api/admin/venues");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(10);

      // venueId = slug 문자열 확인
      const hasSlug = (res.body.data as Array<{ venueId: string }>)
        .every((v) => typeof v.venueId === "string" && /^[a-z0-9-]+$/.test(v.venueId));
      expect(hasSlug).toBe(true);
    });

    it("[1-2] 비관리자 접근 → 403", async () => {
      const res = await normalAgent.get("/api/admin/venues");
      expect(res.status).toBe(403);
    });

    it("[1-3] 인증 없이 접근 → 401", async () => {
      const res = await request(app).get("/api/admin/venues");
      expect(res.status).toBe(401);
    });
  });

  // ─── [3] POST /api/admin/events ──────────────────────────────────────────────

  describe("[3] POST /api/admin/events — 단발 이벤트 생성", () => {
    it("[3-1] 정상 생성 → 201, venueId=slug 응답", async () => {
      const res = await adminAgent
        .post("/api/admin/events")
        .set("Content-Type", "application/json")
        .send({
          title:          "__tev_event_create",
          category:       "concert",
          venueId:        DEFAULT_VENUE_SLUG,
          opensAt:        futureISO(10),
          prize:          "test prize",
          posterColor:    "#AABBCC",
          });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.venueId).toBe(DEFAULT_VENUE_SLUG);
      expect(res.body.data.status).toBe("scheduled");
      expect(res.body.data.eventId).toBeGreaterThan(0);

      createdEventIds.push(res.body.data.eventId);
    });

    it("[3-2] 존재하지 않는 venueId(slug) → 404 VENUE_NOT_FOUND", async () => {
      const res = await adminAgent
        .post("/api/admin/events")
        .set("Content-Type", "application/json")
        .send({
          title:       "__tev_bad_venue",
          category:    "concert",
          venueId:     "nonexistent-v99",
          opensAt:     futureISO(10),
          prize:       "prize",
          posterColor: "#AABBCC",
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("VENUE_NOT_FOUND");
    });

    it("[3-3] opensAt < now+5분 → 400 VALIDATION_ERROR", async () => {
      const res = await adminAgent
        .post("/api/admin/events")
        .set("Content-Type", "application/json")
        .send({
          title:       "__tev_too_soon",
          category:    "concert",
          venueId:     DEFAULT_VENUE_SLUG,
          opensAt:     new Date(Date.now() + 2 * 60 * 1000).toISOString(), // 2분 후
          prize:       "prize",
          posterColor: "#AABBCC",
        });

      expect(res.status).toBe(400);
    });

    it("[3-4] opensAt > now+1년 → 400 VALIDATION_ERROR", async () => {
      const farFuture = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();

      const res = await adminAgent
        .post("/api/admin/events")
        .set("Content-Type", "application/json")
        .send({
          title:       "__tev_too_far",
          category:    "concert",
          venueId:     DEFAULT_VENUE_SLUG,
          opensAt:     farFuture,
          prize:       "prize",
          posterColor: "#AABBCC",
        });

      expect(res.status).toBe(400);
    });

    it("[3-5] 같은 venue 시간 충돌 → 409 EVENT_TIME_CONFLICT", async () => {
      const opensAt = futureISO(30);

      // 첫 번째 이벤트 생성
      const first = await adminAgent
        .post("/api/admin/events")
        .set("Content-Type", "application/json")
        .send({
          title:       "__tev_conflict_first",
          category:    "concert",
          venueId:     "gocheok-skydome-v1",
          opensAt,
          durationMs:  3600000,
          prize:       "prize",
          posterColor: "#AABBCC",
        });

      expect(first.status).toBe(201);
      createdEventIds.push(first.body.data.eventId);

      // 같은 시간대 같은 장소 두 번째 이벤트
      const second = await adminAgent
        .post("/api/admin/events")
        .set("Content-Type", "application/json")
        .send({
          title:       "__tev_conflict_second",
          category:    "concert",
          venueId:     "gocheok-skydome-v1",
          opensAt,
          durationMs:  3600000,
          prize:       "prize",
          posterColor: "#AABBCC",
        });

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("EVENT_TIME_CONFLICT");
    });

    it("[3-6] 비관리자 이벤트 생성 시도 → 403", async () => {
      const res = await normalAgent
        .post("/api/admin/events")
        .set("Content-Type", "application/json")
        .send({
          title:       "__tev_normal_create",
          category:    "concert",
          venueId:     DEFAULT_VENUE_SLUG,
          opensAt:     futureISO(10),
          prize:       "prize",
          posterColor: "#AABBCC",
        });

      expect(res.status).toBe(403);
    });
  });

  // ─── [4] POST /api/admin/event-series ────────────────────────────────────────

  describe("[4] POST /api/admin/event-series — 시리즈 생성", () => {
    it("[4-1] weekly + weekdays 정상 생성 → 201, 인스턴스 목록 반환", async () => {
      const res = await adminAgent
        .post("/api/admin/event-series")
        .set("Content-Type", "application/json")
        .send({
          title:       "__tev_series_weekly",
          category:    "sports",
          venueId:     "ssg-landers-v1",
          prize:       "weekly prize",
          posterColor: "#334455",
          recurrence: {
            kind:     "weekly",
            weekdays: [1, 3, 5], // 월, 수, 금
            startAt:  new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.series.seriesId).toBeGreaterThan(0);
      expect(Array.isArray(res.body.data.createdEvents)).toBe(true);
      expect(res.body.data.createdEvents.length).toBeGreaterThan(0);

      createdSeriesIds.push(res.body.data.series.seriesId);
      res.body.data.createdEvents.forEach((ev: { eventId: number }) => {
        createdEventIds.push(ev.eventId);
      });
    });

    it("[4-2] weekly에 weekdays 비어있으면 400 RECURRENCE_INVALID", async () => {
      const res = await adminAgent
        .post("/api/admin/event-series")
        .set("Content-Type", "application/json")
        .send({
          title:       "__tev_series_bad",
          category:    "sports",
          venueId:     "inspire-arena-v1",
          prize:       "prize",
          posterColor: "#334455",
          recurrence: {
            kind:     "weekly",
            weekdays: [], // 빈 배열
            startAt:  new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
          },
        });

      expect(res.status).toBe(400);
    });

    it("[4-3] 비관리자 시리즈 생성 시도 → 403", async () => {
      const res = await normalAgent
        .post("/api/admin/event-series")
        .set("Content-Type", "application/json")
        .send({
          title:       "__tev_series_normal",
          category:    "sports",
          venueId:     DEFAULT_VENUE_SLUG,
          prize:       "prize",
          posterColor: "#334455",
          recurrence: {
            kind:     "weekly",
            weekdays: [1],
            startAt:  new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
          },
        });

      expect(res.status).toBe(403);
    });
  });

  // ─── [5] PATCH /api/admin/events/:eventId ────────────────────────────────────

  describe("[5] PATCH /api/admin/events/:eventId — 이벤트 수정", () => {
    it("[5-1] scheduled 상태에서 title 수정 → 200", async () => {
      const { eventId } = await createTestEvent({ status: "scheduled" }, admin.userId);
      createdEventIds.push(eventId);

      const newTitle = `__tev_updated_${Date.now()}`;
      const res = await adminAgent
        .patch(`/api/admin/events/${eventId}`)
        .set("Content-Type", "application/json")
        .send({ title: newTitle });

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe(newTitle);
    });

    it("[5-2] scheduled 상태에서 opensAt 수정 → 200", async () => {
      const { eventId } = await createTestEvent({ status: "scheduled" }, admin.userId);
      createdEventIds.push(eventId);

      const newOpensAt = futureISO(20);
      const res = await adminAgent
        .patch(`/api/admin/events/${eventId}`)
        .set("Content-Type", "application/json")
        .send({ opensAt: newOpensAt });

      expect(res.status).toBe(200);
      expect(new Date(res.body.data.opensAt).getTime()).toBeCloseTo(
        new Date(newOpensAt).getTime(),
        -3, // ms 오차 허용
      );
    });

    it("[5-3] open 상태에서 opensAt 수정 시도 → 409 EVENT_ALREADY_STARTED", async () => {
      const opensAt = new Date(Date.now() - 5 * 60 * 1000); // 5분 전 오픈
      const { eventId } = await createTestEvent(
        { status: "open", opensAt },
        admin.userId,
      );
      createdEventIds.push(eventId);

      const res = await adminAgent
        .patch(`/api/admin/events/${eventId}`)
        .set("Content-Type", "application/json")
        .send({ opensAt: futureISO(30) });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("EVENT_ALREADY_STARTED");
    });

    it("[5-4] 취소된 이벤트 수정 → 409 EVENT_CANCEL_FORBIDDEN", async () => {
      const { eventId } = await createTestEvent({ status: "cancelled" }, admin.userId);
      createdEventIds.push(eventId);

      const res = await adminAgent
        .patch(`/api/admin/events/${eventId}`)
        .set("Content-Type", "application/json")
        .send({ title: "should fail" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("EVENT_CANCEL_FORBIDDEN");
    });
  });

  // ─── [6] POST /api/admin/events/:eventId/cancel ──────────────────────────────

  describe("[6] POST /api/admin/events/:eventId/cancel — 이벤트 취소", () => {
    it("[6-1] 정상 취소 → 200, 신청자 전원 무효화 (pending → cancelled)", async () => {
      const user = await createTestUser();
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      // 사용자 신청 직접 INSERT
      await createTestRegistration(eventId, user.userId, {});

      const res = await adminAgent
        .post(`/api/admin/events/${eventId}/cancel`)
        .set("Content-Type", "application/json")
        .send({ reason: "test cancel" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("cancelled");

      // 신청 상태 cancelled 확인
      const regRes = await pool.query(
        `SELECT status, cancelled_at FROM event_registrations
         WHERE event_id = $1 AND user_id = $2`,
        [eventId, user.userId],
      );
      expect(regRes.rows[0].status).toBe("cancelled");
      expect(regRes.rows[0].cancelled_at).not.toBeNull();
    });

    it("[6-2] 이미 취소된 이벤트 재취소 → 409 EVENT_CANCEL_FORBIDDEN", async () => {
      const { eventId } = await createTestEvent({ status: "cancelled" }, admin.userId);
      createdEventIds.push(eventId);

      const res = await adminAgent
        .post(`/api/admin/events/${eventId}/cancel`)
        .set("Content-Type", "application/json")
        .send({ reason: "test" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("EVENT_CANCEL_FORBIDDEN");
    });

    it("[6-3] 존재하지 않는 이벤트 취소 → 404 EVENT_NOT_FOUND", async () => {
      const res = await adminAgent
        .post("/api/admin/events/9999999/cancel")
        .set("Content-Type", "application/json")
        .send({ reason: "test" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("EVENT_NOT_FOUND");
    });

    it("[6-4] reason 누락 → 400 VALIDATION_ERROR", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const res = await adminAgent
        .post(`/api/admin/events/${eventId}/cancel`)
        .set("Content-Type", "application/json")
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ─── [7] POST /api/admin/event-series/:seriesId/cancel ───────────────────────

  describe("[7] POST /api/admin/event-series/:seriesId/cancel — 시리즈 취소", () => {
    it("[7-1] 시리즈 전체 취소 → 200, 하위 이벤트 모두 cancelled", async () => {
      // 시리즈 생성 (daily로 3일간)
      const startAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
      const seriesRes = await adminAgent
        .post("/api/admin/event-series")
        .set("Content-Type", "application/json")
        .send({
          title:       "__tev_series_cancel",
          category:    "theater",
          venueId:     "bluesquare-main-v1",
          prize:       "prize",
          posterColor: "#445566",
          recurrence: {
            kind:    "daily",
            startAt: startAt.toISOString(),
          },
        });

      expect(seriesRes.status).toBe(201);
      const seriesId = seriesRes.body.data.series.seriesId as number;
      const seriesEventIds = (seriesRes.body.data.createdEvents as Array<{ eventId: number }>)
        .map((e) => e.eventId);

      createdSeriesIds.push(seriesId);
      seriesEventIds.forEach((id) => createdEventIds.push(id));

      // 시리즈 전체 취소
      const cancelRes = await adminAgent
        .post(`/api/admin/event-series/${seriesId}/cancel`)
        .set("Content-Type", "application/json")
        .send({});

      expect(cancelRes.status).toBe(200);

      // 하위 이벤트가 모두 cancelled 상태인지 확인
      const checkRes = await pool.query(
        `SELECT status FROM events WHERE series_id = $1`,
        [seriesId],
      );
      const allCancelled = checkRes.rows.every((r) => r.status === "cancelled");
      expect(allCancelled).toBe(true);
    });

    it("[7-2] from 이후만 취소 → from 이전 이벤트는 scheduled 유지", async () => {
      const baseDate = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);

      const seriesRes = await adminAgent
        .post("/api/admin/event-series")
        .set("Content-Type", "application/json")
        .send({
          title:       "__tev_series_partial_cancel",
          category:    "festival",
          venueId:     "hangang-festival-v1",
          prize:       "prize",
          posterColor: "#556677",
          recurrence: {
            kind:    "daily",
            startAt: baseDate.toISOString(),
          },
        });

      expect(seriesRes.status).toBe(201);
      const seriesId = seriesRes.body.data.series.seriesId as number;
      const createdEvs = seriesRes.body.data.createdEvents as Array<{
        eventId: number;
        opensAt: string;
      }>;

      createdSeriesIds.push(seriesId);
      createdEvs.forEach((e) => createdEventIds.push(e.eventId));

      if (createdEvs.length < 2) {
        // 인스턴스가 1개 이하면 건너뜀
        return;
      }

      // 두 번째 이벤트 이후만 취소
      const fromDate = createdEvs[1].opensAt;

      const cancelRes = await adminAgent
        .post(`/api/admin/event-series/${seriesId}/cancel`)
        .set("Content-Type", "application/json")
        .send({ from: fromDate });

      expect(cancelRes.status).toBe(200);

      // 첫 번째 이벤트는 scheduled 유지
      const firstCheck = await pool.query(
        `SELECT status FROM events WHERE id = $1`,
        [createdEvs[0].eventId],
      );
      expect(firstCheck.rows[0].status).toBe("scheduled");
    });

    it("[7-3] 존재하지 않는 seriesId → 404 EVENT_NOT_FOUND", async () => {
      const res = await adminAgent
        .post("/api/admin/event-series/9999999/cancel")
        .set("Content-Type", "application/json")
        .send({});

      expect(res.status).toBe(404);
    });
  });

  // ─── [8] GET /api/admin/events/:eventId/registrations ────────────────────────

  describe("[8] GET /api/admin/events/:eventId/registrations — 신청자 목록", () => {
    it("[8-1] 신청자 목록 조회 → 200, user 정보 포함", async () => {
      const user = await createTestUser();
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      // 신청 직접 INSERT
      await createTestRegistration(eventId, user.userId, {});

      const res = await adminAgent
        .get(`/api/admin/events/${eventId}/registrations`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const reg = res.body.data[0] as {
        user: { id: number; name: string; email: string };
      };
      expect(reg.user).toBeDefined();
      expect(reg.user.id).toBeGreaterThan(0);
    });

    it("[8-2] 빈 이벤트 신청자 목록 → 200, data=[]", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const res = await adminAgent
        .get(`/api/admin/events/${eventId}/registrations`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(0);
      expect(res.body.meta.totalCount).toBe(0);
    });

    it("[8-3] 비관리자 접근 → 403", async () => {
      const { eventId } = await createTestEvent({}, admin.userId);
      createdEventIds.push(eventId);

      const res = await normalAgent
        .get(`/api/admin/events/${eventId}/registrations`);

      expect(res.status).toBe(403);
    });
  });
});
