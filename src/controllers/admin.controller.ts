import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import * as adminService from "../services/admin.service";
import * as liveService from "../services/live.service";
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

// PUT /api/admin/live/config/venue — 공연장·좌석 배치만 저장 (excluded_hours 유지)
const putLiveConfigVenue = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (handleValidation(req, next)) return;

  const { defaultVenueId, defaultSeatLabels } = req.body;
  const updatedBy = req.user!.id;

  const config = await adminService.upsertLiveConfigVenue({
    defaultVenueId: Number(defaultVenueId),
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

// GET /api/admin/live/rounds/:roundId/stats — 라이브 라운드 결과 통계
const getRoundStats = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (handleValidation(req, next)) return;

  try {
    const roundId = parseInt(req.params.roundId as string, 10);
    const data = await liveService.getRoundStats(roundId);
    res.status(200).json({ success: true, data });
  } catch (err) {
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
};

// POST /api/admin/live/cron/run — 크론 작업 수동 실행 (서버 다운타임 백필/디버깅용)
const runCron = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (handleValidation(req, next)) return;

  const job = req.body.job as "ensure" | "transition";
  const fromMidnight = req.body.fromMidnight === true;

  const startedAt = Date.now();
  try {
    switch (job) {
      case "ensure":
        await liveService.ensureUpcomingRounds(fromMidnight);
        break;
      case "transition":
        await liveService.transitionRounds();
        break;
    }
    res.status(200).json({
      success: true,
      data: {
        job,
        fromMidnight: job === "ensure" ? fromMidnight : undefined,
        durationMs: Date.now() - startedAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/live/rounds/create-now — 임시(테스트용): 정각 대기 없이 즉시 open 회차 생성
const createRoundNow = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const data = await adminService.createRoundNow();
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

export {
  getLiveConfig,
  putLiveConfigVenue,
  putLiveConfigSchedule,
  listRounds,
  cancelRound,
  getRoundDetail,
  getRoundStats,
  runCron,
  createRoundNow,
};
