import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import * as participateService from "../services/live_participate.service";
import * as usersService from "../services/users.service";
import { AppError } from "../middlewares/errorHandler";

// ─── 내부 헬퍼 ───────────────────────────────────────────────────────────────

/**
 * express-validator 결과를 검사한다.
 * 에러가 있으면 next(AppError) 호출 후 true 를 반환해 컨트롤러 흐름을 중단시킨다.
 */
function handleValidation(req: Request, next: NextFunction): boolean {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    next(new AppError(422, "VALIDATION_ERROR", errors.array()[0].msg));
    return true;
  }
  return false;
}

/**
 * 서비스에서 throw 된 에러를 HTTP 상태 코드로 매핑한다.
 *
 * code → status:
 *   ROUND_NOT_OPEN      → 409
 *   SESSION_NOT_FOUND   → 404
 *   FORBIDDEN           → 404  (세션 존재 여부 오라클 차단: 소유자 불일치도 "없음"으로 응답)
 *   NOT_ACTIVE          → 403
 *   SEAT_UNAVAILABLE    → 409
 *   HOLD_EXPIRED        → 409
 *   기타                → next(err) 로 전역 핸들러 위임
 */
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
      case "ROUND_NOT_OPEN":
        next(new AppError(409, e.code, e.message));
        return;
      case "SESSION_NOT_FOUND":
        next(new AppError(404, e.code, e.message));
        return;
      case "FORBIDDEN":
        // 소유자 불일치도 404 로 통일 — 공격자가 sessionId 존재 여부를 403/404 로 구분해
        // 내부 세션 ID 공간을 열거하는 오라클 공격을 차단한다.
        next(new AppError(404, "SESSION_NOT_FOUND", "세션을 찾을 수 없습니다"));
        return;
      case "NOT_ACTIVE":
        next(new AppError(403, e.code, e.message));
        return;
      case "SEAT_UNAVAILABLE":
        next(new AppError(409, e.code, e.message));
        return;
      case "HOLD_EXPIRED":
        next(new AppError(409, e.code, e.message));
        return;
      default:
        // 코드가 있지만 매핑 목록에 없는 경우 (ROUND_NOT_FOUND, BAD_REQUEST 등)
        // status 가 명시돼 있으면 그대로 사용
        if (typeof e.status === "number" && typeof e.code === "string") {
          next(new AppError(e.status, e.code, e.message));
          return;
        }
    }
  }
  next(err);
}

/**
 * 게스트 UUID 를 결정한다.
 *
 * 쿠키(guest_uuid, httpOnly)만 신뢰한다.
 * body.guestUuid 폴백은 보안상 제거됨 — UUID 유출 시 세션 강탈 가능성을 차단.
 *
 * 게스트 UUID 는 클라이언트가 `/api/guests` 에서 발급받아 쿠키에 저장해 온다고 가정한다.
 */
function resolveGuestUuid(req: Request): string | undefined {
  return req.cookies?.guest_uuid as string | undefined;
}

// ─── 컨트롤러 함수 ───────────────────────────────────────────────────────────

/**
 * POST /api/live/rounds/:roundId/sessions
 *
 * roundId(param) + nickname(body) 를 받아 createSession 서비스를 호출한다.
 * 회원이면 req.user.id, 게스트면 guest_uuid 쿠키로 식별한다.
 */
const postCreateSession = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (handleValidation(req, next)) return;

  try {
    const roundId = parseInt(req.params.roundId as string, 10);
    const userId = req.user?.id ?? null;
    const guestUuid = userId == null ? resolveGuestUuid(req) : undefined;

    if (userId == null && !guestUuid) {
      return next(
        new AppError(400, "GUEST_UUID_REQUIRED", "게스트 UUID가 필요합니다. guest_uuid 쿠키를 전달해주세요."),
      );
    }

    // nickname 결정 로직:
    // 회원: body.nickname 있으면 사용, 없으면 user.name 조회
    // 게스트: body.nickname 필수, 없으면 400 NICKNAME_REQUIRED
    let nickname: string = req.body.nickname ?? "";

    if (userId != null) {
      if (!nickname) {
        const user = await usersService.getMe(userId);
        nickname = user.name;
      }
    } else {
      if (!nickname) {
        return next(
          new AppError(400, "NICKNAME_REQUIRED", "비로그인 유저는 닉네임이 필요합니다."),
        );
      }
    }

    const data = await participateService.createSession({
      roundId,
      userId,
      guestUuid: guestUuid ?? null,
      nickname,
    });

    res.status(201).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * GET /api/live/sessions/:sessionId/queue
 *
 * sessionId(param) 로 getQueueStatus 서비스를 호출한다.
 * Cache-Control: no-store 를 설정해 폴링 캐시를 차단한다.
 */
const getQueue = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (handleValidation(req, next)) return;

  try {
    const sessionId = req.params.sessionId as string;
    const userId = req.user?.id ?? null;
    const guestUuid = userId == null ? resolveGuestUuid(req) : undefined;

    const data = await participateService.getQueueStatus({
      sessionId,
      userId,
      guestUuid: guestUuid ?? null,
    });

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * GET /api/live/sessions/:sessionId/seats
 *
 * sessionId(param) 로 getSeats 서비스를 호출한다.
 * Cache-Control: no-store 를 설정해 좌석 상태 캐시를 차단한다.
 */
const getSeats = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (handleValidation(req, next)) return;

  try {
    const sessionId = req.params.sessionId as string;
    const userId = req.user?.id ?? null;
    const guestUuid = userId == null ? resolveGuestUuid(req) : undefined;

    const data = await participateService.getSeats({
      sessionId,
      userId,
      guestUuid: guestUuid ?? null,
    });

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * POST /api/live/sessions/:sessionId/hold
 *
 * sessionId(param) + seatLabel(body) 로 holdSeat 서비스를 호출한다.
 */
const postHold = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (handleValidation(req, next)) return;

  try {
    const sessionId = req.params.sessionId as string;
    const { seatLabel } = req.body;
    const userId = req.user?.id ?? null;
    const guestUuid = userId == null ? resolveGuestUuid(req) : undefined;

    const data = await participateService.holdSeat({
      sessionId,
      seatLabel,
      userId,
      guestUuid: guestUuid ?? null,
    });

    res.status(200).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

/**
 * POST /api/live/sessions/:sessionId/confirm
 *
 * sessionId(param) + seatLabel(body) 로 confirmSeat 서비스를 호출한다.
 * 경과 시간(elapsedMs)은 서버에서 직접 계산하므로 body 의 clientElapsedMs 는 무시한다.
 */
const postConfirm = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (handleValidation(req, next)) return;

  try {
    const sessionId = req.params.sessionId as string;
    const { seatLabel } = req.body;
    const userId = req.user?.id ?? null;
    const guestUuid = userId == null ? resolveGuestUuid(req) : undefined;

    const data = await participateService.confirmSeat({
      sessionId,
      seatLabel,
      userId,
      guestUuid: guestUuid ?? null,
    });

    res.status(200).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

export { postCreateSession, getQueue, getSeats, postHold, postConfirm };
