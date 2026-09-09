import { Router } from "express";
import { getRankings, getMyRankings } from "../controllers/rankings.controller";
import {
  getRankingsValidator,
  getMyRankingsValidator,
} from "../middlewares/validators/rankings.validator";
import authMiddleware from "../middlewares/authMiddleware";
import { rankingsLimiter } from "../middlewares/rateLimiter";

const router = Router();

// GET /api/rankings/me — "/" 보다 먼저 등록.
// rankingsLimiter 는 authMiddleware 뒤에 둬야 req.user 기준으로 카운트된다.
router.get(
  "/me",
  authMiddleware,
  rankingsLimiter,
  getMyRankingsValidator,
  getMyRankings,
);

router.get("/", getRankingsValidator, getRankings);

export default router;
