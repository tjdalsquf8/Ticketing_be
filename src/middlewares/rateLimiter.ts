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

// 전역 백스톱. 라우트별 리미터가 실제 정책을 담당하고, 이 리미터는 그 위에서
// 봇/스크립트의 비정상 트래픽만 잘라내는 최후 방어선 역할만 한다.
// 100/min(=초당 1.7회)은 홈 1회 로드가 8요청인 구조에서 정상 사용자를 먼저 막았다.
// 새로고침 10여 번이면 소진돼 사이트 전체가 429 가 되던 원인.
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: envelopeHandler(
    "TOO_MANY_REQUESTS",
    "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  ),
});

// 라이브 티켓팅 API 전용(`/api/live/*`). 대기열 1초 폴링 + 좌석맵 2초 폴링이 동시에
// 도는 구간이 있어 참여자 1명이 분당 90회 이상을 정상적으로 소비한다. 60/min 은
// 혼자서도 넘겼고, IP 기반이라 같은 공유기의 3명이 60 을 나눠 쓰다 즉시 429 가 됐다.
// → 상한을 180/min 으로 올리고, 다른 리미터들과 같이 "참여자 1명" 단위로 카운트한다.
//
// 키 우선순위: 로그인 유저 id → 게스트 uuid 쿠키 → IP.
// live 는 비로그인 게스트도 참여하므로 guest_uuid 까지 키로 인정해야 NAT 뒤 게스트끼리
// 서로 잡아먹지 않는다. 둘 다 없는 완전 익명 조회(/current, /next)만 IP 로 묶인다.
export const liveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  keyGenerator: (req: Request, res: Response) => {
    if (req.user?.id) return `live:u${req.user.id}`;
    const guestUuid = req.cookies?.guest_uuid as string | undefined;
    if (guestUuid) return `live:g${guestUuid}`;
    return ipKeyGenerator(req.ip ?? "unknown");
  },
  handler: envelopeHandler(
    "TOO_MANY_LIVE_REQUESTS",
    "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  ),
});

// 서버 시각 동기화(`/api/time`) 전용. 원래 liveLimiter 버킷을 공유했는데, 홈·이벤트
// 상세 등 티켓팅과 무관한 화면도 이 엔드포인트를 쓰기 때문에 라이브 예산을 갉아먹었다.
// DB 를 타지 않는 초경량 응답이므로 별도 통으로 분리하고 넉넉하게 둔다.
export const timeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: envelopeHandler(
    "TOO_MANY_TIME_REQUESTS",
    "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  ),
});

// 내 기록 조회(`/api/rankings/me`) 전용. 인증 유저 기준으로 카운트하므로 반드시
// authMiddleware 뒤에 배치해야 한다. 앞에 두면 req.user 가 아직 없어 IP 키로 떨어진다.
export const rankingsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  keyGenerator: (req: Request, res: Response) =>
    req.user?.id
      ? `rankings:${req.user.id}`
      : ipKeyGenerator(req.ip ?? "unknown"),
  handler: envelopeHandler(
    "TOO_MANY_RANKING_REQUESTS",
    "랭킹 조회 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  ),
});

// 이벤트 공개 조회 API 전용. `/api/events`, `/calendar`, `/nearest`, `/:eventId` 는
// 인증 여부와 관계없이 대량 폴링·봇 열람 대상이 되기 쉬움. globalLimiter(1분 1000회) 위에
// 얹어 IP 기반으로 더 좁게 제한한다.
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

// 홈 통계(`/api/stats/daily`) 전용. 인증 불필요 공개 조회라 봇 폴링 대상이 되기 쉽고,
// 캐시 미스 시 쿼리 3개가 실행돼 globalLimiter만으로는 부족.
export const statsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: envelopeHandler(
    "TOO_MANY_STATS_REQUESTS",
    "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  ),
});

// 공지사항 공개 조회(`/api/notices`, `/api/notices/:id`) 전용. 인증 불필요 공개 조회.
export const noticesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: envelopeHandler(
    "TOO_MANY_NOTICE_REQUESTS",
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
// 뒤 배치. 60/min 을 유저 단위로 부여.
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
