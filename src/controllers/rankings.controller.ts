import { Request, Response, NextFunction } from "express";
import * as rankingsService from "../services/rankings.service";
import { validationResult } from "express-validator";
import { AppError } from "../middlewares/errorHandler";

const getRankings = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(422, "VALIDATION_ERROR", errors.array()[0].msg));
  }

  const mode = req.query.mode as string;
  const period = req.query.period as string;
  const page = parseInt(req.query.page as string) || 1;
  const size = parseInt(req.query.size as string) || 20;
  const eventId =
    req.query.eventId !== undefined
      ? parseInt(req.query.eventId as string)
      : undefined;

  const { data, total } = await rankingsService.getRankings({
    mode,
    period,
    page,
    size,
    eventId,
  });

  res.status(200).json({
    success: true,
    data,
    meta: { page, size, totalCount: total },
  });
};

// GET /api/rankings/me — 로그인 유저 본인의 기록 전체 (랭킹 진입 여부와 무관)
const getMyRankings = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(422, "VALIDATION_ERROR", errors.array()[0].msg));
  }

  const mode = req.query.mode as string;
  const period = req.query.period as string;
  const page = parseInt(req.query.page as string) || 1;
  const size = parseInt(req.query.size as string) || 20;
  const eventId =
    req.query.eventId !== undefined
      ? parseInt(req.query.eventId as string)
      : undefined;

  const { data, total } = await rankingsService.getMyRankings({
    userId: req.user!.id,
    mode,
    period,
    page,
    size,
    eventId,
  });

  res.status(200).json({
    success: true,
    data,
    meta: { page, size, totalCount: total },
  });
};

export { getRankings, getMyRankings };
