import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import { AppError } from "../middlewares/errorHandler";
import * as eventsService from "../services/events.service";
import { runHideEndedEvents } from "../jobs/hideEndedEvents";

// ─── 내부 헬퍼 ───────────────────────────────────────────────────────────────

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

// ─── 관리자 컨트롤러 ─────────────────────────────────────────────────────────

/**
 * GET /api/admin/events
 * 관리자 이벤트 목록 (cancelled 포함)
 */
const adminListEvents = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const page  = parseInt(req.query.page  as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    // includeHidden 쿼리는 문자열 "true"/"false" 로 도착. 미지정 시 undefined → 서비스 기본값(true) 적용.
    const includeHiddenRaw = req.query.includeHidden;
    const includeHidden =
      includeHiddenRaw === undefined ? undefined : includeHiddenRaw !== "false";

    const { data, totalCount } = await eventsService.adminListEvents({
      status:   req.query.status   as string | undefined,
      category: req.query.category as string | undefined,
      from:     req.query.from     as string | undefined,
      to:       req.query.to       as string | undefined,
      includeHidden,
      page,
      limit,
    });

    res.status(200).json({
      success: true,
      data,
      meta: { totalCount, page, limit },
    });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * POST /api/admin/events
 * 단발 이벤트 생성
 */
const createEvent = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const createdBy = req.user!.id;
    // Mass Assignment 방지: 서비스 시그니처가 허용하는 필드만 명시적으로 추출.
    // req.body 를 통째 넘기지 않아 향후 서비스 시그니처 확장 시 예기치 못한
    // 관리자 지정 필드(status/createdBy 등)가 삽입되는 경로를 원천 차단.
    const {
      type, title, category, venueId, opensAt, durationMs,
      entryFeePoints, prize, posterColor, posterInitial,
    } = req.body;
    const data = await eventsService.createEvent(
      { type, title, category, venueId, opensAt, durationMs,
        entryFeePoints, prize, posterColor, posterInitial },
      createdBy,
    );
    res.status(201).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * POST /api/admin/event-series
 * 반복 시리즈 생성
 */
const createEventSeries = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const createdBy = req.user!.id;
    // Mass Assignment 방지: 허용 필드만 추출.
    const {
      title, category, venueId, durationMs, entryFeePoints,
      prize, posterColor, posterInitial, recurrence,
    } = req.body;
    const data = await eventsService.createEventSeries(
      { title, category, venueId, durationMs, entryFeePoints,
        prize, posterColor, posterInitial, recurrence },
      createdBy,
    );
    res.status(201).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * PATCH /api/admin/events/:eventId
 * 이벤트 단건 수정
 */
const updateEvent = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    // Mass Assignment 방지: 서비스 updateEvent 시그니처가 허용하는 필드만 추출.
    // status/registeredCount/cancelledAt 등 상태 필드가 body 로 스며들지 못하게 차단.
    const {
      title, category, venueId, opensAt, durationMs,
      entryFeePoints, prize, posterColor, posterInitial,
    } = req.body;
    const data = await eventsService.updateEvent(eventId, {
      title, category, venueId, opensAt, durationMs,
      entryFeePoints, prize, posterColor, posterInitial,
    });
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * POST /api/admin/events/:eventId/cancel
 * 이벤트 취소 + 신청자 자동 환불
 */
const cancelEvent = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const { reason } = req.body;
    const data = await eventsService.cancelEvent(eventId, reason);
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * POST /api/admin/event-series/:seriesId/cancel
 * 시리즈 전체(또는 from 이후) 취소
 */
const cancelSeries = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const seriesId = parseInt(req.params.seriesId as string, 10);
    const { from } = req.body;
    await eventsService.cancelSeries(seriesId, from);
    res.status(200).json({ success: true, data: null });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * GET /api/admin/events/:eventId/registrations
 * 신청자 목록 (감사·정산)
 */
const adminListRegistrations = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const page  = parseInt(req.query.page  as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const { data, totalCount } = await eventsService.adminListRegistrations(eventId, {
      status: req.query.status as string | undefined,
      page,
      limit,
    });

    res.status(200).json({
      success: true,
      data,
      meta: { totalCount, page, limit },
    });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * GET /api/admin/events/:eventId/stats
 * 이벤트 결과 통계 (registered/ticketed/noShow/netRevenue)
 */
const adminGetEventStats = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const data = await eventsService.getEventStats(eventId);
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * GET /api/admin/venues
 * 공연장 목록
 */
const listVenues = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await eventsService.listVenues();
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * POST /api/admin/events/cleanup
 * 종료·취소 이벤트 수동 정리 (hidden_at 세팅). 크론이 놓친 경우 관리자가 즉시 실행.
 */
const cleanupEndedEvents = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await runHideEndedEvents();
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    handleServiceError(err, next);
  }
};

export {
  adminListEvents,
  createEvent,
  createEventSeries,
  updateEvent,
  cancelEvent,
  cancelSeries,
  adminListRegistrations,
  adminGetEventStats,
  listVenues,
  cleanupEndedEvents,
};
