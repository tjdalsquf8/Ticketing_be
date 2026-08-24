import { body, param, query } from "express-validator";

const SEAT_LABEL_PATTERN = /^[A-Za-z0-9가-힣]+-\d+-\d+$/;

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

/** POST /rounds/:roundId/sessions body */
const createSessionBodyValidator = [
  body("nickname")
    .optional()
    .trim()
    .isLength({ min: 1, max: 30 })
    .withMessage("nickname은 1~30자여야 합니다."),
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
    .withMessage("seatLabel 은 'zoneId-row-col' 형식 (예: A-1-1) 이어야 합니다."),
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
    .withMessage("seatLabel 은 'zoneId-row-col' 형식 (예: A-1-1) 이어야 합니다."),
];

/** GET /last-round?limit=N — 선택적 limit 파라미터 (1~30 정수) */
const getLastRoundQueryValidator = [
  query("limit")
    .optional()
    .isInt({ min: 1, max: 30 })
    .withMessage("limit은 1~30 범위의 정수여야 합니다."),
];

export {
  roundIdParamValidator,
  sessionIdParamValidator,
  createSessionBodyValidator,
  holdBodyValidator,
  confirmBodyValidator,
  getLastRoundQueryValidator,
};
