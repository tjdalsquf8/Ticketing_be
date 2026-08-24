import { Router } from "express";
import * as liveController from "../controllers/live.controller";
import * as participateController from "../controllers/live_participate.controller";
import { liveLimiter } from "../middlewares/rateLimiter";
import optionalAuthMiddleware from "../middlewares/optionalAuthMiddleware";
import {
  roundIdParamValidator,
  sessionIdParamValidator,
  createSessionBodyValidator,
  holdBodyValidator,
  confirmBodyValidator,
  getLastRoundQueryValidator,
} from "../middlewares/validators/live_participate.validator";

const router = Router();

router.use(liveLimiter);

// ─── 공개 조회 라우트 ──────────────────────────────────────────────────────────
router.get("/current", liveController.getCurrent);
router.get("/next", liveController.getNext);
router.get("/last-round", getLastRoundQueryValidator, liveController.getLastRound);
router.get("/rounds/:roundId", roundIdParamValidator, liveController.getRoundById);

// ─── 참여 API 라우트 ──────────────────────────────────────────────────────────
router.post(
  "/rounds/:roundId/sessions",
  optionalAuthMiddleware,
  roundIdParamValidator,
  createSessionBodyValidator,
  participateController.postCreateSession,
);

router.get(
  "/sessions/:sessionId/queue",
  optionalAuthMiddleware,
  sessionIdParamValidator,
  participateController.getQueue,
);

router.get(
  "/sessions/:sessionId/seats",
  optionalAuthMiddleware,
  sessionIdParamValidator,
  participateController.getSeats,
);

router.post(
  "/sessions/:sessionId/hold",
  optionalAuthMiddleware,
  sessionIdParamValidator,
  holdBodyValidator,
  participateController.postHold,
);

router.post(
  "/sessions/:sessionId/confirm",
  optionalAuthMiddleware,
  sessionIdParamValidator,
  confirmBodyValidator,
  participateController.postConfirm,
);

export default router;
