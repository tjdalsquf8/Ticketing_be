import { Router } from "express";
import { eventsLimiter } from "../middlewares/rateLimiter";
import * as venuesController from "../controllers/venues.controller";
import { slugParamValidator } from "../middlewares/validators/venues.validator";

const router = Router();

// GET /api/venues/:slug — 공연장 상세(geometry 포함) 공개 조회
router.get(
  "/:slug",
  eventsLimiter,
  slugParamValidator,
  venuesController.getVenueBySlug,
);

export default router;
