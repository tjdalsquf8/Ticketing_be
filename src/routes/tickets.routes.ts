import { Router } from "express";
import authMiddleware from "../middlewares/authMiddleware";
import * as ticketsController from "../controllers/tickets.controller";
import {
  getMyTicketsQueryValidator,
  ticketIdParamValidator,
} from "../middlewares/validators/tickets.validator";
import { ticketsLimiter } from "../middlewares/rateLimiter";

const router = Router();

// 인증 사용자 기준 60회/분 제한 — ticketId 열거 오라클 공격 및 대량 폴링 방지
router.use(ticketsLimiter);

// GET /api/tickets/me — 내 티켓 목록 (페이지네이션)
router.get(
  "/me",
  authMiddleware,
  getMyTicketsQueryValidator,
  ticketsController.getMyTicketsHandler,
);

// GET /api/tickets/:ticketId — 티켓 단건 상세 조회
router.get(
  "/:ticketId",
  authMiddleware,
  ticketIdParamValidator,
  ticketsController.getTicketByIdHandler,
);

export default router;
