import { Router } from "express";
import authMiddleware from "../middlewares/authMiddleware";
import requireAdmin from "../middlewares/requireAdmin";
import { adminLimiter, gifticonDetailLimiter } from "../middlewares/rateLimiter";
import * as adminController from "../controllers/admin.controller";
import * as adminEventsController from "../controllers/admin.events.controller";
import * as gifticonsController from "../controllers/gifticons.controller";
import * as settlementsController from "../controllers/settlements.controller";
import {
  putConfigVenueValidator,
  putConfigScheduleValidator,
  listRoundsValidator,
  roundIdParamValidator,
  runCronValidator,
} from "../middlewares/validators/admin.validator";
import {
  gifticonIdParamValidator,
  listGifticonsQueryValidator,
  createGifticonBodyValidator,
  updateGifticonBodyValidator,
} from "../middlewares/validators/gifticons.validator";
import {
  settlementIdParamValidator,
  listSettlementsQueryValidator,
  issueSettlementBodyValidator,
} from "../middlewares/validators/settlements.validator";
import {
  eventIdParamValidator,
  seriesIdParamValidator,
  adminListEventsQueryValidator,
  createEventBodyValidator,
  createSeriesBodyValidator,
  updateEventBodyValidator,
  cancelEventBodyValidator,
  cancelSeriesBodyValidator,
  adminListRegistrationsQueryValidator,
} from "../middlewares/validators/events.validator";

const router = Router();

// 순서 주의:
// 1) authMiddleware — JWT 검증(빠름, DB 미접근)
// 2) adminLimiter   — 인증된 user.id 기준으로 rate limit
// 3) requireAdmin   — DB에서 users.role 조회. limiter 통과 요청만 도달.
router.use(authMiddleware, adminLimiter, requireAdmin);

// Live config
router.get("/live/config", adminController.getLiveConfig);
router.put(
  "/live/config/venue",
  putConfigVenueValidator,
  adminController.putLiveConfigVenue,
);
router.put(
  "/live/config/schedule",
  putConfigScheduleValidator,
  adminController.putLiveConfigSchedule,
);

// Live rounds
router.get("/live/rounds", listRoundsValidator, adminController.listRounds);
router.get(
  "/live/rounds/:roundId/detail",
  roundIdParamValidator,
  adminController.getRoundDetail,
);
router.get(
  "/live/rounds/:roundId/stats",
  roundIdParamValidator,
  adminController.getRoundStats,
);
router.patch(
  "/live/rounds/:roundId/cancel",
  roundIdParamValidator,
  adminController.cancelRound,
);

// Live cron 수동 실행
router.post(
  "/live/cron/run",
  runCronValidator,
  adminController.runCron,
);

// ─── 이벤트 관리 ─────────────────────────────────────────────────────────────

// GET /api/admin/venues
router.get("/venues", adminEventsController.listVenues);

// GET /api/admin/events
router.get(
  "/events",
  adminListEventsQueryValidator,
  adminEventsController.adminListEvents,
);

// POST /api/admin/events
router.post(
  "/events",
  createEventBodyValidator,
  adminEventsController.createEvent,
);

// POST /api/admin/events/cleanup — 종료·취소 이벤트 수동 숨김 (크론 미발화 백필용)
router.post(
  "/events/cleanup",
  adminEventsController.cleanupEndedEvents,
);

// POST /api/admin/event-series
router.post(
  "/event-series",
  createSeriesBodyValidator,
  adminEventsController.createEventSeries,
);

// PATCH /api/admin/events/:eventId
router.patch(
  "/events/:eventId",
  eventIdParamValidator,
  updateEventBodyValidator,
  adminEventsController.updateEvent,
);

// POST /api/admin/events/:eventId/cancel
router.post(
  "/events/:eventId/cancel",
  eventIdParamValidator,
  cancelEventBodyValidator,
  adminEventsController.cancelEvent,
);

// GET /api/admin/events/:eventId/registrations
router.get(
  "/events/:eventId/registrations",
  eventIdParamValidator,
  adminListRegistrationsQueryValidator,
  adminEventsController.adminListRegistrations,
);

// GET /api/admin/events/:eventId/stats
router.get(
  "/events/:eventId/stats",
  eventIdParamValidator,
  adminEventsController.adminGetEventStats,
);

// POST /api/admin/event-series/:seriesId/cancel
router.post(
  "/event-series/:seriesId/cancel",
  seriesIdParamValidator,
  cancelSeriesBodyValidator,
  adminEventsController.cancelSeries,
);

// ─── 기프티콘 재고 관리 ──────────────────────────────────────────────────────

// GET /api/admin/gifticons/summary — :id 라우트보다 먼저 선언해야 "summary"가 id로 매칭되지 않음
router.get("/gifticons/summary", gifticonsController.getSummary);

router.get(
  "/gifticons",
  listGifticonsQueryValidator,
  gifticonsController.listGifticons,
);

// 원본 바코드가 노출되는 유일한 경로 — adminLimiter 위에 전용 제한 추가
router.get(
  "/gifticons/:id",
  gifticonDetailLimiter,
  gifticonIdParamValidator,
  gifticonsController.getGifticonDetail,
);

router.post(
  "/gifticons",
  createGifticonBodyValidator,
  gifticonsController.createGifticon,
);

router.patch(
  "/gifticons/:id",
  gifticonIdParamValidator,
  updateGifticonBodyValidator,
  gifticonsController.updateGifticon,
);

router.delete(
  "/gifticons/:id",
  gifticonIdParamValidator,
  gifticonsController.deleteGifticon,
);

// ─── 정산 이력(기프티콘) ─────────────────────────────────────────────────────

router.get(
  "/settlements/gifticons",
  listSettlementsQueryValidator,
  settlementsController.listSettlements,
);

router.post(
  "/settlements/gifticons/:id/issue",
  settlementIdParamValidator,
  issueSettlementBodyValidator,
  settlementsController.issueSettlement,
);

export default router;
