import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import { AppError } from "../middlewares/errorHandler";
import * as eventsService from "../services/events.service";

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

// ─── 공개 API 컨트롤러 ───────────────────────────────────────────────────────

/**
 * GET /api/events
 * 이벤트 목록 조회 (type='live' 제외)
 */
const listEvents = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const page  = parseInt(req.query.page  as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const { data, totalCount } = await eventsService.listEvents({
      status:   req.query.status   as string | undefined,
      category: req.query.category as string | undefined,
      from:     req.query.from     as string | undefined,
      to:       req.query.to       as string | undefined,
      page,
      limit,
    });

    res.setHeader("Cache-Control", "public, max-age=60");
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
 * GET /api/events/calendar?ym=YYYY-MM
 * 월간 캘린더 조회
 */
const getCalendar = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const ym = req.query.ym as string;
    const data = await eventsService.getCalendar(ym);

    // 캐싱은 추후 Redis 로 서버 캐시 + 이벤트 CRUD 시 무효화 정책과 함께 도입 예정.
    // 현 시점에는 관리자 즉시 반영 UX 우선. 브라우저 캐시 헤더 제거.
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * GET /api/events/rankings/latest?limit=100
 * 마지막으로 종료된 이벤트의 참여자 랭킹.
 * 공개 조회 (인증 불필요). 종료 이벤트가 없으면 event=null.
 */
const getLatestEventRankings = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const data = await eventsService.getLatestClosedEventRankings(limit);

    // 짧은 캐시로 랭킹 폴링 부하 완화. 종료 이벤트가 확정된 후에는 데이터 변경
    // 거의 없으므로 5초 캐시로 충분.
    res.setHeader("Cache-Control", "public, max-age=5");
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * GET /api/events/nearest
 * 가장 가까운 예정 이벤트
 */
const getNearestEvent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await eventsService.getNearestEvent();
    res.setHeader("Cache-Control", "public, max-age=60");
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * GET /api/events/registrations/me
 * 내 신청 목록
 */
const listMyRegistrations = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const userId = req.user!.id;
    const page  = parseInt(req.query.page  as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const { data, totalCount } = await eventsService.listMyRegistrations(userId, {
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
 * GET /api/events/:eventId
 * 이벤트 상세. 로그인 시 myRegistration 포함
 */
const getEventById = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const userId  = req.user?.id ?? null;

    const data = await eventsService.getEventById(eventId, userId);
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * POST /api/events/:eventId/registrations
 * 참여 신청 (회원 전용)
 */
const registerEvent = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const userId  = req.user!.id;

    const data = await eventsService.registerEvent(eventId, userId);
    res.status(201).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * POST /api/events/:eventId/sessions
 * 티켓팅 세션 시작 (사전 신청자만)
 */
const startEventSession = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const eventId = parseInt(req.params.eventId as string, 10);
    const userId  = req.user?.id;

    if (!userId) {
      return next(new AppError(401, "AUTH_TOKEN_MISSING", "로그인이 필요합니다."));
    }

    const data = await eventsService.startEventSession(eventId, userId);
    res.status(201).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

export {
  listEvents,
  getCalendar,
  getNearestEvent,
  getLatestEventRankings,
  listMyRegistrations,
  getEventById,
  registerEvent,
  startEventSession,
};
