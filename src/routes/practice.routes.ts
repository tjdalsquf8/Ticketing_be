import { Router } from "express";
import { startSession, completeSession } from "../controllers/practice.controller";
import optionalAuthMiddleware from "../middlewares/optionalAuthMiddleware";
import { startSessionValidator, completeSessionValidator } from "../middlewares/validators/practice.validator";

const router = Router();

router.post("/sessions", optionalAuthMiddleware, startSessionValidator, startSession);
router.post("/sessions/:sessionId/complete", optionalAuthMiddleware, completeSessionValidator, completeSession);

export default router;
