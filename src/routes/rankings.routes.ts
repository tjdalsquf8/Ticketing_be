import { Router } from "express";
import { getRankings, getMyRankings, getMyBestRanking } from "../controllers/rankings.controller";
import {
  getRankingsValidator,
  getMyRankingsValidator,
  getMyBestRankingValidator,
} from "../middlewares/validators/rankings.validator";
import optionalAuthMiddleware from "../middlewares/optionalAuthMiddleware";
import { rankingsLimiter } from "../middlewares/rateLimiter";

const router = Router();

// GET /api/rankings/me/best — "/me" 보다 먼저 등록. 인증 불필요(게스트도 조회 가능),
// req.user 채우기용으로 optionalAuthMiddleware 만 태운다.
router.get(
  "/me/best",
  optionalAuthMiddleware,
  getMyBestRankingValidator,
  getMyBestRanking,
);

// GET /api/rankings/me — "/" 보다 먼저 등록. 인증 불필요(게스트도 자기 시도 이력 조회).
// rankingsLimiter 는 인증 파싱 뒤에 둬야 req.user 기준으로 카운트된다.
router.get(
  "/me",
  optionalAuthMiddleware,
  rankingsLimiter,
  getMyRankingsValidator,
  getMyRankings,
);

router.get("/", getRankingsValidator, getRankings);

export default router;
