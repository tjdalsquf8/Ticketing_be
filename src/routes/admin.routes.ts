import { Router } from "express";
import authMiddleware from "../middlewares/authMiddleware";
import requireAdmin from "../middlewares/requireAdmin";
import { adminLimiter } from "../middlewares/rateLimiter";
import * as adminController from "../controllers/admin.controller";
import {
  putConfigEventValidator,
  putConfigScheduleValidator,
  listRoundsValidator,
  roundIdParamValidator,
} from "../middlewares/validators/admin.validator";

const router = Router();

// 순서 주의:
// 1) authMiddleware — JWT 검증(빠름, DB 미접근)
// 2) adminLimiter   — 인증된 user.id 기준으로 rate limit
// 3) requireAdmin   — DB에서 users.role 조회. limiter 통과 요청만 도달.
router.use(authMiddleware, adminLimiter, requireAdmin);

// Live config
router.get("/live/config", adminController.getLiveConfig);
router.put(
  "/live/config/event",
  putConfigEventValidator,
  adminController.putLiveConfigEvent,
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
router.patch(
  "/live/rounds/:roundId/cancel",
  roundIdParamValidator,
  adminController.cancelRound,
);

export default router;
