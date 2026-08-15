import { Router } from "express";
import * as timeController from "../controllers/time.controller";
import { liveLimiter } from "../middlewares/rateLimiter";

const router = Router();

router.use(liveLimiter);

router.get("/", timeController.getTime);

export default router;
