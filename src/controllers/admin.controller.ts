import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import * as adminService from "../services/admin.service";
import { AppError } from "../middlewares/errorHandler";

const handleValidation = (req: Request, next: NextFunction): boolean => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    next(new AppError(422, "VALIDATION_ERROR", errors.array()[0].msg));
    return true;
  }
  return false;
};

// ─── Config ──────────────────────────────────────────────────

// GET /api/admin/live/config — 현재 라이브 기본 규칙(공연·좌석배열) 조회
const getLiveConfig = async (_req: Request, res: Response) => {
  const config = await adminService.getLiveConfig();
  res.status(200).json({ success: true, data: config });
};

// PUT /api/admin/live/config/event — 공연 배치만 저장 (excluded_hours 유지)
const putLiveConfigEvent = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (handleValidation(req, next)) return;

  const { defaultEventId, defaultSeatLabels } = req.body;
  const updatedBy = req.user!.id;

  const config = await adminService.upsertLiveConfigEvent({
    defaultEventId: Number(defaultEventId),
    defaultSeatLabels,
    updatedBy,
  });
  res.status(200).json({ success: true, data: config });
};

// PUT /api/admin/live/config/schedule — 회차 제외 시간대만 저장 (공연 배치 유지)
const putLiveConfigSchedule = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (handleValidation(req, next)) return;

  const { excludedHours } = req.body;
  const updatedBy = req.user!.id;

  const config = await adminService.updateLiveConfigSchedule({
    excludedHours,
    updatedBy,
  });
  res.status(200).json({ success: true, data: config });
};

// ─── Rounds ──────────────────────────────────────────────────

// GET /api/admin/live/rounds — 회차 목록 조회 (예정/진행중/종료, 날짜·기간 필터)
const listRounds = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (handleValidation(req, next)) return;

  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const date = req.query.date as string | undefined;
  const data = await adminService.listRounds({ from, to, date });
  res.status(200).json({ success: true, data });
};

// PATCH /api/admin/live/rounds/:roundId/cancel — 아직 시작 전(scheduled) 회차 취소
const cancelRound = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (handleValidation(req, next)) return;

  const data = await adminService.cancelRound(Number(req.params.roundId));
  res.status(200).json({ success: true, data });
};

// GET /api/admin/live/rounds/:roundId/detail — 회차 상세 (대기 인원·좌석 요약·top10) 모니터링
const getRoundDetail = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (handleValidation(req, next)) return;

  const data = await adminService.getRoundDetail(Number(req.params.roundId));
  res.status(200).json({ success: true, data });
};

export {
  getLiveConfig,
  putLiveConfigEvent,
  putLiveConfigSchedule,
  listRounds,
  cancelRound,
  getRoundDetail,
};
