import { Router } from "express";
import * as timeController from "../controllers/time.controller";
import { timeLimiter } from "../middlewares/rateLimiter";

const router = Router();

router.use(timeLimiter);

router.get("/", timeController.getTime);

export default router;
