import { Router } from "express";
import authRouter from "./auth.routes";
import usersRouter from "./users.routes";
import practiceRouter from "./practice.routes";
import rankingsRouter from "./rankings.routes";
import guestsRouter from "./guests.routes";
import adminRouter from "./admin.routes";
import liveRouter from "./live.routes";
import timeRouter from "./time.routes";
import ticketsRouter from "./tickets.routes";
import eventsRouter from "./events.routes";
import statsRouter from "./stats.routes";
import noticesRouter from "./notices.routes";
import venuesRouter from "./venues.routes";

const router = Router();

router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/practice", practiceRouter);
router.use("/rankings", rankingsRouter);
router.use("/guests", guestsRouter);
router.use("/admin", adminRouter);
router.use("/live", liveRouter);
router.use("/time", timeRouter);
router.use("/tickets", ticketsRouter);
router.use("/events", eventsRouter);
router.use("/stats", statsRouter);
router.use("/notices", noticesRouter);
router.use("/venues", venuesRouter);

export default router;
