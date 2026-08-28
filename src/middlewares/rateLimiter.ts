import rateLimit, { Options, ipKeyGenerator } from "express-rate-limit";
import { Request, Response } from "express";

const skipInTest = () => process.env.NODE_ENV === "test";

function envelopeHandler(code: string, message: string) {
  return (_req: Request, res: Response, _next: unknown, options: Options) => {
    res.status(options.statusCode).json({
      success: false,
      error: { code, message },
    });
  };
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: envelopeHandler(
    "TOO_MANY_LOGIN_ATTEMPTS",
    "로그인 시도가 너무 많습니다. 15분 후 다시 시도해주세요.",
  ),
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: envelopeHandler(
    "TOO_MANY_REGISTER_ATTEMPTS",
    "회원가입 시도가 너무 많습니다. 1시간 후 다시 시도해주세요.",
  ),
});

export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: envelopeHandler(
    "TOO_MANY_REFRESH_ATTEMPTS",
    "토큰 갱신 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  ),
});

export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: envelopeHandler(
    "TOO_MANY_REQUESTS",
    "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  ),
});

// 공개 라이브 조회 API 전용. `/api/live/current`, `/next`, `/recent-results`, `/api/time`
// 은 인증 없이 열려있어 봇/스크립트가 대량 폴링해 DB 를 태울 수 있음.
// globalLimiter(1분 100회) 위에 얹어 더 좁게 제한. IP 기반 → 익명 트래픽 컷.
export const liveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: envelopeHandler(
    "TOO_MANY_LIVE_REQUESTS",
    "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  ),
});

// 티켓 조회 API 전용. 인증 사용자가 ticketId 를 순차 열거(오라클 공격)하거나
// 대량 폴링으로 DB 를 태우는 것을 방지. user.id 기준으로 카운트해
// 같은 IP 를 공유하는 다른 사용자에게 영향이 없도록 한다.
export const ticketsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  keyGenerator: (req: Request, res: Response) =>
    req.user?.id
      ? `tickets:${req.user.id}`
      : ipKeyGenerator(req.ip ?? "unknown"),
  handler: envelopeHandler(
    "TOO_MANY_TICKET_REQUESTS",
    "티켓 조회 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  ),
});

// 이벤트 공개 조회 API 전용. `/api/events`, `/calendar`, `/nearest`, `/:eventId` 는
// 인증 여부와 관계없이 대량 폴링·봇 열람 대상이 되기 쉬움. globalLimiter(1분 100회) 위에
// 얹어 IP 기반으로 더 좁게 제한한다. liveLimiter 와 같은 정책(60/min).
export const eventsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: envelopeHandler(
    "TOO_MANY_EVENT_REQUESTS",
    "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  ),
});

// 이벤트 신청·취소·세션 시작 API 전용. 포인트 차감·티켓팅 세션 생성 등 상태 변경을
// 동반하므로 봇의 자동화 공격(예: 오픈 직전 다중 계정 사전 신청, 세션 재시작 남용)에
// 대비해 엄격하게 제한한다. authMiddleware 뒤에 배치해 인증된 유저 id 로 카운트하고
// 같은 IP(NAT/사내망) 상 다른 유저에게 영향이 없도록 한다.
export const eventActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  keyGenerator: (req: Request, res: Response) =>
    req.user?.id
      ? `event-action:${req.user.id}`
      : ipKeyGenerator(req.ip ?? "unknown"),
  handler: envelopeHandler(
    "TOO_MANY_EVENT_ACTIONS",
    "이벤트 신청 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  ),
});

// 이벤트 티켓팅 세션 후속 호출(queue/seats/hold/confirm) 전용. 좌석맵 폴링·좌석 잡기
// 시도가 반복될 수 있어 완만하게, 그러나 인증 유저 기준 상한을 둔다. authMiddleware
// 뒤 배치. liveLimiter(60/min) 와 유사하게 60/min 을 유저 단위로 부여.
export const eventSessionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  keyGenerator: (req: Request, res: Response) =>
    req.user?.id
      ? `event-session:${req.user.id}`
      : ipKeyGenerator(req.ip ?? "unknown"),
  handler: envelopeHandler(
    "TOO_MANY_EVENT_SESSION_REQUESTS",
    "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  ),
});

// 관리자 라우트 전용. requireAdmin 이 매 요청마다 users.role DB 조회를 하므로
// 토큰 탈취/오작동 클라이언트가 대량 폴링 시 DB 커넥션 풀이 소진될 수 있음.
// authMiddleware 뒤에 배치해 인증된 요청 기준으로 카운트하고, 인증된 유저 id 를
// 키로 사용해 여러 어드민이 같은 IP(NAT/사내망)에서 상호 영향받지 않도록 한다.
export const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  // IPv6 는 개별 IP 가 아닌 /64 서브넷 단위로 카운트해야 우회 방지.
  // express-rate-limit 의 ipKeyGenerator helper 가 IPv4/IPv6 를 안전하게 정규화.
  keyGenerator: (req: Request, res: Response) =>
    req.user?.id
      ? `admin:${req.user.id}`
      : ipKeyGenerator(req.ip ?? "unknown"),
  handler: envelopeHandler(
    "TOO_MANY_ADMIN_REQUESTS",
    "관리자 API 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  ),
});

// 기프티콘 상세 조회(GET /admin/gifticons/:id) 전용. 원본 바코드(=환금성 자산)가
// 노출되는 유일한 경로라 adminLimiter(200/min)보다 훨씬 좁게 제한해 대량 열람으로
// 인한 코드 유출 시도를 막는다. loginLimiter 수준으로 보수적으로 설정.
export const gifticonDetailLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  keyGenerator: (req: Request, res: Response) =>
    req.user?.id
      ? `gifticon-detail:${req.user.id}`
      : ipKeyGenerator(req.ip ?? "unknown"),
  handler: envelopeHandler(
    "TOO_MANY_GIFTICON_DETAIL_REQUESTS",
    "기프티콘 상세 조회 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  ),
});
