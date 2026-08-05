import { Router } from "express";
import authRouter from "./auth.routes";
import usersRouter from "./users.routes";
import practiceRouter from "./practice.routes";
import rankingsRouter from "./rankings.routes";

const router = Router();

router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/practice", practiceRouter);
router.use("/rankings", rankingsRouter);

export default router;
