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
