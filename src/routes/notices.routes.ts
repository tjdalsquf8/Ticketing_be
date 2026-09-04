import { Router } from "express";
import * as noticesController from "../controllers/notices.controller";
import { noticesLimiter } from "../middlewares/rateLimiter";
import {
  listNoticesQueryValidator,
  noticeIdParamValidator,
} from "../middlewares/validators/notices.validator";

const router = Router();

router.use(noticesLimiter);

router.get("/", listNoticesQueryValidator, noticesController.listNotices);
router.get("/:id", noticeIdParamValidator, noticesController.getNoticeById);

export default router;
