import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import * as ticketsService from "../services/tickets.service";
import { AppError } from "../middlewares/errorHandler";

// ─── 내부 헬퍼 ───────────────────────────────────────────────────────────────

function handleValidation(req: Request, next: NextFunction): boolean {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    next(new AppError(422, "VALIDATION_ERROR", errors.array()[0].msg));
    return true;
  }
  return false;
}

function handleServiceError(err: unknown, next: NextFunction): void {
  if (
    err != null &&
    typeof err === "object" &&
    "code" in err &&
    "status" in err &&
    "message" in err
  ) {
    const e = err as { code: string; status: number; message: string };
    switch (e.code) {
      case "TICKET_NOT_FOUND":
        next(new AppError(404, e.code, e.message));
        return;
      case "TICKET_FORBIDDEN":
        next(new AppError(403, e.code, e.message));
        return;
      default:
        if (typeof e.status === "number" && typeof e.code === "string") {
          next(new AppError(e.status, e.code, e.message));
          return;
        }
    }
  }
  next(err);
}

// ─── 컨트롤러 함수 ───────────────────────────────────────────────────────────

/**
 * GET /api/tickets/me
 *
 * 로그인한 사용자의 티켓 목록을 페이지네이션으로 반환한다.
 */
const getMyTicketsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (handleValidation(req, next)) return;

  try {
    const userId = req.user!.id;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit as string) || 20),
    );

    const { items, total } = await ticketsService.getMyTickets({
      userId,
      page,
      limit,
    });

    res.status(200).json({
      success: true,
      data: items,
      meta: { page, size: limit, totalCount: total },
    });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * GET /api/tickets/:ticketId
 *
 * 특정 티켓의 상세 정보를 반환한다.
 * 본인 소유가 아니면 403, 존재하지 않으면 404 를 반환한다.
 */
const getTicketByIdHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (handleValidation(req, next)) return;

  try {
    const userId = req.user!.id;
    const ticketId = parseInt(req.params["ticketId"] as string, 10);

    const data = await ticketsService.getTicketById({ userId, ticketId });

    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    handleServiceError(err, next);
  }
};

export { getMyTicketsHandler, getTicketByIdHandler };
