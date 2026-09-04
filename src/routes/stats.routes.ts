import { Router } from "express";
import * as statsController from "../controllers/stats.controller";
import { statsLimiter } from "../middlewares/rateLimiter";

const router = Router();

router.get("/daily", statsLimiter, statsController.getDailyStats);

export default router;
