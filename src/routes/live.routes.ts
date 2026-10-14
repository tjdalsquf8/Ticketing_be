import { Router } from "express";
import * as liveController from "../controllers/live.controller";
import * as participateController from "../controllers/live_participate.controller";
import { liveLimiter } from "../middlewares/rateLimiter";
import optionalAuthMiddleware from "../middlewares/optionalAuthMiddleware";
import {
  roundIdParamValidator,
  getRoundRankingsQueryValidator,
  sessionIdParamValidator,
  createSessionBodyValidator,
  holdBodyValidator,
  confirmBodyValidator,
  getLastRoundQueryValidator,
  seatsStreamQueryValidator,
  queueStreamQueryValidator,
} from "../middlewares/validators/live_participate.validator";

const router = Router();

// optionalAuthMiddleware 를 liveLimiter 보다 먼저 태운다.
// liveLimiter 가 req.user 기준으로 카운트하므로, 인증 파싱이 뒤에 오면 로그인 유저도
// 항상 IP 키로 떨어져 같은 공유기 사용자끼리 예산을 나눠 쓰게 된다.
router.use(optionalAuthMiddleware);
router.use(liveLimiter);

// ─── 공개 조회 라우트 ──────────────────────────────────────────────────────────
router.get("/current", liveController.getCurrent);
router.get("/next", liveController.getNext);
router.get("/last-round", getLastRoundQueryValidator, liveController.getLastRound);
router.get("/rounds/:roundId", roundIdParamValidator, liveController.getRoundById);
router.get(
  "/rounds/:roundId/rankings",
  getRoundRankingsQueryValidator,
  liveController.getRoundRankings,
);

// ─── 참여 API 라우트 ──────────────────────────────────────────────────────────
router.post(
  "/rounds/:roundId/sessions",
  roundIdParamValidator,
  createSessionBodyValidator,
  participateController.postCreateSession,
);

router.get(
  "/rounds/:roundId/queue/stream",
  queueStreamQueryValidator,
  participateController.getQueueStream,
);

router.get(
  "/rounds/:roundId/seats/stream",
  seatsStreamQueryValidator,
  participateController.getSeatsStream,
);

router.post(
  "/sessions/:sessionId/hold",
  sessionIdParamValidator,
  holdBodyValidator,
  participateController.postHold,
);

router.post(
  "/sessions/:sessionId/confirm",
  sessionIdParamValidator,
  confirmBodyValidator,
  participateController.postConfirm,
);

router.delete(
  "/sessions/:sessionId",
  sessionIdParamValidator,
  participateController.deleteSession,
);

export default router;
