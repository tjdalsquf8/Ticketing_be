import { NextFunction, Request, Response } from "express";
import { validationResult } from "express-validator";
import * as liveService from "../services/live.service";
import { AppError } from "../middlewares/errorHandler";

// GET /api/live/current — 지금 진행중 회차 (없으면 null)
const getCurrent = async (_req: Request, res: Response) => {
  const data = await liveService.getCurrent();
  res.status(200).json({ success: true, data });
};

// GET /api/live/next — 다음 예정 회차 (없으면 null)
const getNext = async (_req: Request, res: Response) => {
  const data = await liveService.getNext();
  res.status(200).json({ success: true, data });
};

// GET /api/live/last-round?limit=N — 가장 최근 종료 회차 + 상위 N명 랭킹
const getLastRound = async (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(422, "VALIDATION_ERROR", errors.array()[0].msg));
  }

  try {
    const rawLimit = Number(req.query.limit);
    const limit =
      Number.isFinite(rawLimit) && rawLimit >= 1
        ? Math.min(Math.floor(rawLimit), 30)
        : 10;
    const data = await liveService.getLastRoundTopN(limit);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// GET /api/live/rounds/:roundId — 특정 회차 상세 조회 (공개, 인증 불필요)
const getRoundById = async (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(422, "VALIDATION_ERROR", errors.array()[0].msg));
  }

  try {
    const roundId = parseInt(req.params["roundId"] as string, 10);
    const data = await liveService.getRoundById(roundId);

    if (data === null) {
      return next(new AppError(404, "ROUND_NOT_FOUND", "존재하지 않는 회차입니다."));
    }

    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

export { getCurrent, getNext, getLastRound, getRoundById };
