import { Router } from "express";
import * as liveController from "../controllers/live.controller";
import { liveLimiter } from "../middlewares/rateLimiter";

const router = Router();

router.use(liveLimiter);

router.get("/current", liveController.getCurrent);
router.get("/next", liveController.getNext);
router.get("/recent-results", liveController.getRecentResults);

export default router;
