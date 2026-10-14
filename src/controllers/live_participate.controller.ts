import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import * as participateService from "../services/live_participate.service";
import * as usersService from "../services/users.service";
import { AppError } from "../middlewares/errorHandler";
import config from "../config";
import {
  seatEvents,
  seatChannel,
  SeatEventPayload,
  SeatContextType,
} from "../events/seatEvents";
import { queueEvents, queueChannel } from "../events/queueEvents";

// ─── 내부 헬퍼 ───────────────────────────────────────────────────────────────

/**
 * express-validator 결과를 검사한다.
 * 에러가 있으면 next(AppError) 호출 후 true 를 반환해 컨트롤러 흐름을 중단시킨다.
 */
function handleValidation(req: Request, next: NextFunction): boolean {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const first = errors.array()[0] as { msg: string; path?: string; param?: string };
    // seatLabel 형식 위반은 프론트에서 별도 UX(좌석맵 즉시 refresh 등)로 다루도록
    // 전용 코드 노출. 그 외 필드는 일반 VALIDATION_ERROR 유지.
    const field = first.path ?? first.param;
    if (field === "seatLabel") {
      next(new AppError(422, "INVALID_SEAT_LABEL", first.msg));
      return true;
    }
    next(new AppError(422, "VALIDATION_ERROR", first.msg));
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
 *   NOT_ACTIVE              → 403
 *   SEAT_ALREADY_HELD       → 409  (다른 세션이 임시 점유 중)
 *   SEAT_ALREADY_CONFIRMED  → 409  (이미 확정·판매됨)
 *   SEAT_UNAVAILABLE        → 409  (그 외 비정상 상태 fallback)
 *   HOLD_EXPIRED            → 409
 *   ALREADY_COMPLETED       → 409  (완료된 세션은 이탈 대상이 아님)
 *   기타                     → next(err) 로 전역 핸들러 위임
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
      case "SEAT_ALREADY_HELD":
      case "SEAT_ALREADY_CONFIRMED":
      case "SEAT_UNAVAILABLE":
        next(new AppError(409, e.code, e.message));
        return;
      case "HOLD_EXPIRED":
        next(new AppError(409, e.code, e.message));
        return;
      case "ALREADY_COMPLETED":
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

    // 만료 토큰으로 접근한 로그인 유저를 게스트로 저장하면 이후 티켓 발급 판정
    // (session.user_id 기준) 이 영구히 skip 된다. 데이터 오염 원천 차단 위해 401 로 거절.
    // 프론트는 401 AUTH_INVALID_TOKEN 로 refresh 후 재시도.
    if (userId == null && req.authExpired) {
      return next(
        new AppError(401, "AUTH_INVALID_TOKEN", "인증 토큰이 만료되었습니다. 다시 시도해주세요."),
      );
    }

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
 * GET /api/live/rounds/:roundId/queue/stream?sessionId=...
 * GET /api/events/:eventId/queue/stream?sessionId=...
 *
 * 대기열 순번 SSE 스트림. REST 폴링(GET .../queue)을 완전히 대체한다.
 * 좌석 스트림과 달리 payload 자체에 순번을 담지 않는다 — 순번은 세션마다 다르게
 * 계산되는 값이라, queueEvents 는 "이 회차/이벤트 대기열에 변화가 생겼다"는 신호만
 * 보내고, 신호를 받을 때마다 기존 getQueueStatus() 를 다시 호출해 본인 순번을
 * 재계산해서 내려준다 — 폴링 때와 동일한 계산 로직을 그대로 재사용한다.
 */
function createQueueStreamHandler(contextType: SeatContextType) {
  const contextParamName = contextType === "round" ? "roundId" : "eventId";

  return async (req: Request, res: Response, next: NextFunction) => {
    if (handleValidation(req, next)) return;

    const contextId = parseInt(req.params[contextParamName] as string, 10);
    const sessionId = req.query.sessionId as string;
    const userId = req.user?.id ?? null;
    const guestUuid = userId == null ? resolveGuestUuid(req) : undefined;

    const fetchStatus = () =>
      participateService.getQueueStatus({
        sessionId,
        userId,
        guestUuid: guestUuid ?? null,
      });

    let snapshot;
    try {
      snapshot = await fetchStatus();
    } catch (err) {
      handleServiceError(err, next);
      return;
    }

    if (snapshot.contextType !== contextType || snapshot.contextId !== contextId) {
      next(new AppError(404, "SESSION_NOT_FOUND", "세션을 찾을 수 없습니다"));
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send("snapshot", snapshot);

    const channel = queueChannel(contextType, contextId);
    const onQueueChanged = (): void => {
      fetchStatus()
        .then((fresh) => send("queue_update", fresh))
        .catch((err) => {
          console.error("[live/queue-stream] refetch failed:", err);
        });
    };
    queueEvents.on(channel, onQueueChanged);

    // ttl 의 절반 주기로 갱신해 항상 최소 2회분 여유를 둔다 (좌석 스트림과 동일 정책).
    const heartbeatMs = Math.max(
      1000,
      Math.min(15000, Math.floor((config.live.sessionHeartbeatTtlSeconds * 1000) / 2)),
    );
    const heartbeat = setInterval(() => {
      res.write(`: ping\n\n`);
      participateService.touchSessionHeartbeat(sessionId).catch((err) => {
        console.error("[live/queue-stream] heartbeat failed:", err);
      });
    }, heartbeatMs);

    req.on("close", () => {
      clearInterval(heartbeat);
      queueEvents.off(channel, onQueueChanged);
      res.end();
    });
  };
}

const getQueueStream = createQueueStreamHandler("round");
const getEventQueueStream = createQueueStreamHandler("event");

/**
 * GET /api/live/rounds/:roundId/seats/stream?sessionId=...
 * GET /api/events/:eventId/seats/stream?sessionId=...
 *
 * 좌석맵 SSE 스트림. REST 폴링(GET .../seats)을 완전히 대체한다.
 * sessionId(query) 로 소유자·active 상태를 검증하고, 그 세션이 실제로 path 의
 * roundId/eventId 소속인지 확인한다(다른 회차·이벤트 세션으로 잘못 구독하는 것 방지).
 *
 * 연결 성공 시:
 *   1. 기존 getSeats() 스냅샷을 "snapshot" 이벤트로 1회 전송
 *   2. round/event 채널을 구독해 이후 좌석 변경을 "seat_update" 이벤트로 push
 *   3. heartbeat 주기마다 (a) 프록시/브라우저 idle timeout 방지용 SSE 주석 전송,
 *      (b) live_sessions.last_seen_at 갱신 — 폴링이 대신하던 "보고 있다" 신호를
 *      SSE 커넥션이 대신 남겨야 sweepStaleSessions 크론이 활성 유저를 방치 세션으로
 *      오판해 끊어버리지 않는다.
 */
function createSeatsStreamHandler(contextType: SeatContextType) {
  const contextParamName = contextType === "round" ? "roundId" : "eventId";

  return async (req: Request, res: Response, next: NextFunction) => {
    if (handleValidation(req, next)) return;

    const contextId = parseInt(req.params[contextParamName] as string, 10);
    const sessionId = req.query.sessionId as string;
    const userId = req.user?.id ?? null;
    const guestUuid = userId == null ? resolveGuestUuid(req) : undefined;

    let snapshot;
    try {
      snapshot = await participateService.getSeats({
        sessionId,
        userId,
        guestUuid: guestUuid ?? null,
      });
    } catch (err) {
      handleServiceError(err, next);
      return;
    }

    // sessionId 는 유효하지만 다른 회차/이벤트 소속인 경우 — 존재 여부 오라클 차단을
    // 위해 FORBIDDEN 과 동일하게 404 SESSION_NOT_FOUND 로 통일한다.
    if (snapshot.contextType !== contextType || snapshot.contextId !== contextId) {
      next(new AppError(404, "SESSION_NOT_FOUND", "세션을 찾을 수 없습니다"));
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send("snapshot", { seats: snapshot.seats, myHold: snapshot.myHold });

    const channel = seatChannel(contextType, contextId);
    const onSeatUpdate = (payload: SeatEventPayload): void => {
      send("seat_update", payload);
    };
    seatEvents.on(channel, onSeatUpdate);

    // ttl 의 절반 주기로 갱신해 항상 최소 2회분 여유를 둔다. 관리자가 ttl 을
    // 짧게(10초) 잡아도 heartbeat 가 못 따라가 세션이 끊기는 일이 없도록 함.
    const heartbeatMs = Math.max(
      1000,
      Math.min(15000, Math.floor((config.live.sessionHeartbeatTtlSeconds * 1000) / 2)),
    );
    const heartbeat = setInterval(() => {
      res.write(`: ping\n\n`);
      participateService.touchSessionHeartbeat(sessionId).catch((err) => {
        console.error("[live/seats-stream] heartbeat failed:", err);
      });
    }, heartbeatMs);

    req.on("close", () => {
      clearInterval(heartbeat);
      seatEvents.off(channel, onSeatUpdate);
      res.end();
    });
  };
}

const getSeatsStream = createSeatsStreamHandler("round");
const getEventSeatsStream = createSeatsStreamHandler("event");

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

/**
 * DELETE /api/live/sessions/:sessionId
 *
 * 좌석 화면·대기열 오버레이에서 "나가기"를 누를 때 호출한다.
 * active/queued 세션을 종료(failed)하고, hold 중이던 좌석이 있으면 반환한다.
 * completed 세션은 409 ALREADY_COMPLETED.
 */
const deleteSession = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (handleValidation(req, next)) return;

  try {
    const sessionId = req.params.sessionId as string;
    const userId = req.user?.id ?? null;
    const guestUuid = userId == null ? resolveGuestUuid(req) : undefined;

    const data = await participateService.abandonSession({
      sessionId,
      userId,
      guestUuid: guestUuid ?? null,
    });

    res.status(200).json({ success: true, data });
  } catch (err) {
    handleServiceError(err, next);
  }
};

export {
  postCreateSession,
  getQueueStream,
  getEventQueueStream,
  getSeatsStream,
  getEventSeatsStream,
  postHold,
  postConfirm,
  deleteSession,
};
