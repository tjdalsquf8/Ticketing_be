import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import { AppError } from "../middlewares/errorHandler";
import * as venuesService from "../services/venues.service";

function handleValidation(req: Request, next: NextFunction): boolean {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    next(new AppError(400, "VALIDATION_ERROR", errors.array()[0].msg));
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
    if (typeof e.status === "number" && typeof e.code === "string") {
      next(new AppError(e.status, e.code, e.message));
      return;
    }
  }
  next(err);
}

/**
 * GET /api/venues/:slug
 * 공연장 상세(geometry 포함) 조회 — 실시간/이벤트 좌석 선택 화면 공용.
 */
const getVenueBySlug = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const venue = await venuesService.getVenueBySlug(req.params.slug as string);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json({ success: true, data: venue });
  } catch (err) {
    handleServiceError(err, next);
  }
};

export { getVenueBySlug };
