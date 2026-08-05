import { Router } from "express";
import { getRankings } from "../controllers/rankings.controller";
import { getRankingsValidator } from "../middlewares/validators/rankings.validator";

const router = Router();

router.get("/", getRankingsValidator, getRankings);

export default router;
