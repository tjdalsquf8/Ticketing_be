import { Router } from "express";
import * as guestsController from "../controllers/guests.controller";
import { postGuestValidator } from "../middlewares/validators/guests.validator";
import {
  guestIssueLimiter,
  guestNicknameLimiter,
} from "../middlewares/rateLimiter";

const router = Router();

// 두 리미터는 서로 배타적이다 — 쿠키 없는 요청(신규 발급)은 guestIssueLimiter 만,
// 쿠키 있는 요청(닉네임 갱신)은 guestNicknameLimiter 만 카운트한다.
router.post(
  "/",
  guestIssueLimiter,
  guestNicknameLimiter,
  postGuestValidator,
  guestsController.postGuest,
);
router.get("/me", guestsController.getMe);

export default router;
