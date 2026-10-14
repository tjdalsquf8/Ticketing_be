import { Router } from "express";
import authMiddleware from "../middlewares/authMiddleware";
import optionalAuthMiddleware from "../middlewares/optionalAuthMiddleware";
import {
  eventsLimiter,
  eventActionLimiter,
  eventSessionLimiter,
} from "../middlewares/rateLimiter";
import * as eventsController from "../controllers/events.controller";
import * as participateController from "../controllers/live_participate.controller";
import {
  eventIdParamValidator,
  listEventsQueryValidator,
  calendarQueryValidator,
  listMyRegistrationsQueryValidator,
  latestRankingsQueryValidator,
  eventSeatsStreamQueryValidator,
  eventQueueStreamQueryValidator,
} from "../middlewares/validators/events.validator";
import {
  sessionIdParamValidator,
  holdBodyValidator,
  confirmBodyValidator,
} from "../middlewares/validators/live_participate.validator";

const router = Router();

// ─── 공개 조회 (인증 선택) ───────────────────────────────────────────────────
// eventsLimiter: 봇/스크립트의 대량 폴링 대비. IP 기반 60/min.

// GET /api/events/calendar — 순서 주의: :eventId 보다 먼저 등록
router.get(
  "/calendar",
  eventsLimiter,
  calendarQueryValidator,
  eventsController.getCalendar,
);

// GET /api/events/nearest
router.get(
  "/nearest",
  eventsLimiter,
  eventsController.getNearestEvent,
);

// GET /api/events/rankings/latest — :eventId 보다 먼저 등록 필수
// 마지막으로 종료된 이벤트의 참여자 랭킹 (공개)
router.get(
  "/rankings/latest",
  eventsLimiter,
  latestRankingsQueryValidator,
  eventsController.getLatestEventRankings,
);

// GET /api/events/registrations/me — :eventId 보다 먼저 등록 필수
router.get(
  "/registrations/me",
  authMiddleware,
  eventsLimiter,
  listMyRegistrationsQueryValidator,
  eventsController.listMyRegistrations,
);

// GET /api/events
router.get(
  "/",
  eventsLimiter,
  listEventsQueryValidator,
  eventsController.listEvents,
);

// GET /api/events/:eventId — 로그인 시 myRegistration 포함
router.get(
  "/:eventId",
  optionalAuthMiddleware,
  eventsLimiter,
  eventIdParamValidator,
  eventsController.getEventById,
);

// ─── 사전 신청 (회원 전용) ───────────────────────────────────────────────────
// eventActionLimiter: 신청 상태 변경 동반. 유저 기반 10/min 엄격 제한.

// POST /api/events/:eventId/registrations
router.post(
  "/:eventId/registrations",
  authMiddleware,
  eventActionLimiter,
  eventIdParamValidator,
  eventsController.registerEvent,
);

// ─── 티켓팅 세션 (섹션 5) ────────────────────────────────────────────────────
// 명세: 라이브 흐름 재활용, 세션 시작은 사전 신청자만
// authMiddleware 강제: 이벤트 세션은 회원 전용. sessionId 유출 시 타인 hold/confirm
// 방지 위해 optionalAuth → authMiddleware 로 강화. 서비스 레이어의 userId 소유자
// 검증(FORBIDDEN → 404 오라클 차단 포함)이 최종 방어선.

// POST /api/events/:eventId/sessions
router.post(
  "/:eventId/sessions",
  authMiddleware,
  eventActionLimiter,
  eventIdParamValidator,
  eventsController.startEventSession,
);

// POST /api/events/sessions/:sessionId/hold
// POST /api/events/sessions/:sessionId/confirm
// → 기존 live_participate.controller 재사용 (세션 ID 기반, round_id와 event_id 무관)

// GET /api/events/:eventId/queue/stream?sessionId=... — 대기열 순번 SSE 스트림.
router.get(
  "/:eventId/queue/stream",
  authMiddleware,
  eventSessionLimiter,
  eventQueueStreamQueryValidator,
  participateController.getEventQueueStream,
);

// GET /api/events/:eventId/seats/stream?sessionId=... — 좌석맵 SSE 스트림.
// eventId 로 스코프해 다른 이벤트 좌석 변경이 섞이지 않게 한다.
router.get(
  "/:eventId/seats/stream",
  authMiddleware,
  eventSessionLimiter,
  eventSeatsStreamQueryValidator,
  participateController.getEventSeatsStream,
);

router.post(
  "/sessions/:sessionId/hold",
  authMiddleware,
  eventSessionLimiter,
  sessionIdParamValidator,
  holdBodyValidator,
  participateController.postHold,
);

router.post(
  "/sessions/:sessionId/confirm",
  authMiddleware,
  eventSessionLimiter,
  sessionIdParamValidator,
  confirmBodyValidator,
  participateController.postConfirm,
);

export default router;
