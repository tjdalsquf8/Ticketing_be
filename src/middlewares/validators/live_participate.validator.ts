import { body, param, query } from "express-validator";

// 좌석 라벨: '{zoneId}-{rowLabel}-{seatNumber}' 3-segment 형식 (프론트 계약)
// - zoneId: 1~32자, 영문/숫자/한글/언더스코어 (하이픈 금지 — 세그먼트 파싱 모호성 방지)
// - rowLabel: 1~16자, 동일 문자셋
// - seatNumber: 1~999, 앞자리 0 금지
// 예: FC-1-1, 101-1-6, R-1L앞-24, GA-스탠딩L-31
const SEAT_LABEL_PATTERN = /^[A-Za-z0-9가-힣_]{1,32}-[A-Za-z0-9가-힣_]{1,16}-[1-9]\d{0,2}$/;

/** roundId 경로 파라미터 — 양수 정수 */
const roundIdParamValidator = [
  param("roundId")
    .isInt({ min: 1 })
    .withMessage("roundId는 1 이상의 정수여야 합니다."),
];

/** sessionId 경로 파라미터 — 20자 소문자 hex (crypto.randomBytes(10).toString('hex') 형식) */
const sessionIdParamValidator = [
  param("sessionId")
    .trim()
    .notEmpty()
    .withMessage("sessionId는 필수입니다.")
    .matches(/^[0-9a-f]{20}$/)
    .withMessage("sessionId 형식이 올바르지 않습니다."),
];

/**
 * POST /rounds/:roundId/sessions body
 *
 * 규칙은 guests·practice 의 nickname 과 동일하게 맞춘다.
 * 여기만 길이·문자셋이 느슨하면 게스트 발급 쪽 검증을 세워도 라이브 참여 시
 * nickname 을 직접 실어 보내는 경로로 그대로 우회된다 (제로폭 문자 등).
 */
const createSessionBodyValidator = [
  body("nickname")
    .optional()
    .trim()
    .isLength({ min: 2, max: 10 }).withMessage("닉네임은 2~10자여야 합니다.")
    .matches(/^[가-힣a-zA-Z0-9_-]+$/)
    .withMessage("닉네임은 한글, 영문, 숫자, _, - 만 사용 가능합니다."),
];

/** POST /sessions/:sessionId/hold body */
const holdBodyValidator = [
  body("seatLabel")
    .trim()
    .notEmpty()
    .withMessage("seatLabel은 필수입니다.")
    .isLength({ min: 1, max: 32 })
    .withMessage("seatLabel은 1~32자여야 합니다.")
    .matches(SEAT_LABEL_PATTERN)
    .withMessage("seatLabel은 '{zoneId}-{rowLabel}-{seatNumber}' 3-segment 형식이어야 합니다 (예: FC-1-1, GA-스탠딩L-3-1)."),
];

/** POST /sessions/:sessionId/confirm body */
const confirmBodyValidator = [
  body("seatLabel")
    .trim()
    .notEmpty()
    .withMessage("seatLabel은 필수입니다.")
    .isLength({ min: 1, max: 32 })
    .withMessage("seatLabel은 1~32자여야 합니다.")
    .matches(SEAT_LABEL_PATTERN)
    .withMessage("seatLabel은 '{zoneId}-{rowLabel}-{seatNumber}' 3-segment 형식이어야 합니다 (예: FC-1-1, GA-스탠딩L-3-1)."),
];

/** GET /last-round?limit=N — 선택적 limit 파라미터 (1~30 정수) */
const getLastRoundQueryValidator = [
  query("limit")
    .optional()
    .isInt({ min: 1, max: 30 })
    .withMessage("limit은 1~30 범위의 정수여야 합니다."),
];

/**
 * GET /rounds/:roundId/rankings?page&size
 *
 * page 상한을 두지 않는다 — 누적 랭킹과 달리 회차 참가자는 전원 조회 대상이다.
 * size 상한 100 은 누적 랭킹과 맞춘다 (한 번에 퍼가는 양 제한).
 */
const getRoundRankingsQueryValidator = [
  ...roundIdParamValidator,
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("page는 1 이상의 정수여야 합니다."),
  query("size")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("size는 1~100 사이의 정수여야 합니다."),
];

export {
  roundIdParamValidator,
  getRoundRankingsQueryValidator,
  sessionIdParamValidator,
  createSessionBodyValidator,
  holdBodyValidator,
  confirmBodyValidator,
  getLastRoundQueryValidator,
};
