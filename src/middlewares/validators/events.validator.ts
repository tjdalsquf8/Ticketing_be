import { body, param, query } from "express-validator";
import { sessionIdQueryValidator } from "./live_participate.validator";

// ─── 공통 ─────────────────────────────────────────────────────────────────────

const VALID_CATEGORIES = ["concert", "musical", "sports", "theater", "festival"] as const;
const VALID_STATUSES   = ["scheduled", "open", "closed", "cancelled"] as const;
const VALID_REG_STATUSES = ["pending", "entered", "ticketed", "missed", "no_show", "cancelled"] as const;

/** eventId 경로 파라미터 */
const eventIdParamValidator = [
  param("eventId")
    .isInt({ min: 1 })
    .withMessage("eventId는 1 이상의 정수여야 합니다."),
];

/** seriesId 경로 파라미터 */
const seriesIdParamValidator = [
  param("seriesId")
    .isInt({ min: 1 })
    .withMessage("seriesId는 1 이상의 정수여야 합니다."),
];

// ─── GET /api/events 쿼리 ────────────────────────────────────────────────────

const listEventsQueryValidator = [
  query("status")
    .optional()
    .isIn(VALID_STATUSES)
    .withMessage(`status는 ${VALID_STATUSES.join("|")} 중 하나여야 합니다.`),
  query("category")
    .optional()
    .isIn(VALID_CATEGORIES)
    .withMessage(`category는 ${VALID_CATEGORIES.join("|")} 중 하나여야 합니다.`),
  query("from")
    .optional()
    .isISO8601()
    .withMessage("from은 ISO8601 형식이어야 합니다."),
  query("to")
    .optional()
    .isISO8601()
    .withMessage("to는 ISO8601 형식이어야 합니다."),
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("page는 1 이상의 정수여야 합니다."),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit은 1~100 범위의 정수여야 합니다."),
];

// ─── GET /api/admin/events 쿼리 ─────────────────────────────────────────────
// listEventsQueryValidator 를 재사용하되 관리자 전용 includeHidden 추가.

const adminListEventsQueryValidator = [
  ...listEventsQueryValidator,
  query("includeHidden")
    .optional()
    .isBoolean()
    .withMessage("includeHidden는 boolean이어야 합니다."),
];

// ─── GET /api/events/calendar 쿼리 ──────────────────────────────────────────

const calendarQueryValidator = [
  query("ym")
    .notEmpty()
    .withMessage("ym은 필수입니다.")
    .matches(/^\d{4}-(0[1-9]|1[0-2])$/)
    .withMessage("ym은 YYYY-MM 형식이어야 합니다."),
];

// ─── GET /api/events/rankings/latest 쿼리 ───────────────────────────────────

const latestRankingsQueryValidator = [
  query("limit")
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage("limit은 1~500 범위의 정수여야 합니다."),
];

// ─── GET /api/events/registrations/me 쿼리 ───────────────────────────────────

const listMyRegistrationsQueryValidator = [
  query("status")
    .optional()
    .isIn(VALID_REG_STATUSES)
    .withMessage(`status는 ${VALID_REG_STATUSES.join("|")} 중 하나여야 합니다.`),
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("page는 1 이상의 정수여야 합니다."),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit은 1~100 범위의 정수여야 합니다."),
];

// ─── POST /api/admin/events body ─────────────────────────────────────────────

const createEventBodyValidator = [
  body("type")
    .optional()
    .equals("paid")
    .withMessage("type은 'paid'만 허용됩니다."),
  body("title")
    .trim()
    .notEmpty()
    .withMessage("title은 필수입니다.")
    .isLength({ min: 1, max: 80 })
    .withMessage("title은 1~80자여야 합니다."),
  body("category")
    .isIn(VALID_CATEGORIES)
    .withMessage(`category는 ${VALID_CATEGORIES.join("|")} 중 하나여야 합니다.`),
  body("venueId")
    .isString()
    .withMessage("venueId는 문자열이어야 합니다.")
    .matches(/^[a-z0-9-]+$/)
    .withMessage("venueId는 slug 형식(소문자, 숫자, 하이픈)이어야 합니다."),
  body("opensAt")
    .isISO8601()
    .withMessage("opensAt은 ISO8601 형식이어야 합니다."),
  body("durationMs")
    .optional()
    // 상한 24시간(86,400,000ms). 실수/악의로 수년~수십년 뒤 closesAt 설정 방지.
    .isInt({ min: 1, max: 86400000 })
    .withMessage("durationMs는 1~86,400,000(24시간) 범위의 정수여야 합니다."),
  body("prize")
    .trim()
    .notEmpty()
    .withMessage("prize는 필수입니다.")
    .isLength({ min: 1, max: 120 })
    .withMessage("prize는 1~120자여야 합니다."),
  body("posterColor")
    .trim()
    .notEmpty()
    .withMessage("posterColor는 필수입니다.")
    .matches(/^#[0-9A-Fa-f]{6}$/)
    .withMessage("posterColor는 #RRGGBB 형식이어야 합니다."),
  body("posterInitial")
    .optional()
    .trim()
    .isLength({ max: 8 })
    .withMessage("posterInitial은 최대 8자여야 합니다."),
];

// ─── POST /api/admin/event-series body ───────────────────────────────────────

const createSeriesBodyValidator = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("title은 필수입니다.")
    .isLength({ min: 1, max: 80 })
    .withMessage("title은 1~80자여야 합니다."),
  body("category")
    .isIn(VALID_CATEGORIES)
    .withMessage(`category는 ${VALID_CATEGORIES.join("|")} 중 하나여야 합니다.`),
  body("venueId")
    .isString()
    .withMessage("venueId는 문자열이어야 합니다.")
    .matches(/^[a-z0-9-]+$/)
    .withMessage("venueId는 slug 형식(소문자, 숫자, 하이픈)이어야 합니다."),
  body("durationMs")
    .optional()
    // 상한 24시간(86,400,000ms). 실수/악의로 수년~수십년 뒤 closesAt 설정 방지.
    .isInt({ min: 1, max: 86400000 })
    .withMessage("durationMs는 1~86,400,000(24시간) 범위의 정수여야 합니다."),
  body("prize")
    .trim()
    .notEmpty()
    .withMessage("prize는 필수입니다.")
    .isLength({ min: 1, max: 120 })
    .withMessage("prize는 1~120자여야 합니다."),
  body("posterColor")
    .trim()
    .notEmpty()
    .withMessage("posterColor는 필수입니다.")
    .matches(/^#[0-9A-Fa-f]{6}$/)
    .withMessage("posterColor는 #RRGGBB 형식이어야 합니다."),
  body("posterInitial")
    .optional()
    .trim()
    .isLength({ max: 8 })
    .withMessage("posterInitial은 최대 8자여야 합니다."),
  body("recurrence")
    .notEmpty()
    .withMessage("recurrence는 필수입니다.")
    .isObject()
    .withMessage("recurrence는 객체여야 합니다."),
  body("recurrence.kind")
    .isIn(["daily", "weekly", "monthly"])
    .withMessage("recurrence.kind는 daily|weekly|monthly 중 하나여야 합니다."),
  body("recurrence.startAt")
    .isISO8601()
    .withMessage("recurrence.startAt은 ISO8601 형식이어야 합니다."),
  body("recurrence.weekdays")
    .if(body("recurrence.kind").equals("weekly"))
    .isArray({ min: 1 })
    .withMessage("weekly 반복에는 weekdays 배열이 필수입니다.")
    .custom((arr: unknown[]) => arr.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))
    .withMessage("weekdays 값은 0(일)~6(토) 정수여야 합니다."),
];

// ─── PATCH /api/admin/events/:eventId body ───────────────────────────────────

const updateEventBodyValidator = [
  body("title")
    .optional()
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage("title은 1~80자여야 합니다."),
  body("category")
    .optional()
    .isIn(VALID_CATEGORIES)
    .withMessage(`category는 ${VALID_CATEGORIES.join("|")} 중 하나여야 합니다.`),
  body("venueId")
    .optional()
    .isString()
    .withMessage("venueId는 문자열이어야 합니다.")
    .matches(/^[a-z0-9-]+$/)
    .withMessage("venueId는 slug 형식(소문자, 숫자, 하이픈)이어야 합니다."),
  body("opensAt")
    .optional()
    .isISO8601()
    .withMessage("opensAt은 ISO8601 형식이어야 합니다."),
  body("durationMs")
    .optional()
    // 상한 24시간(86,400,000ms). 실수/악의로 수년~수십년 뒤 closesAt 설정 방지.
    .isInt({ min: 1, max: 86400000 })
    .withMessage("durationMs는 1~86,400,000(24시간) 범위의 정수여야 합니다."),
  body("prize")
    .optional()
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage("prize는 1~120자여야 합니다."),
  body("posterColor")
    .optional()
    .trim()
    .matches(/^#[0-9A-Fa-f]{6}$/)
    .withMessage("posterColor는 #RRGGBB 형식이어야 합니다."),
  body("posterInitial")
    .optional()
    .trim()
    .isLength({ max: 8 })
    .withMessage("posterInitial은 최대 8자여야 합니다."),
];

// ─── POST /api/admin/events/:eventId/cancel body ─────────────────────────────

const cancelEventBodyValidator = [
  body("reason")
    .trim()
    .notEmpty()
    .withMessage("reason은 필수입니다.")
    // 무제한 저장 시 수 MB 텍스트가 events.cancel_reason 에 들어가 DB 팽창·응답
    // 페이로드 폭증 유발. 운영 사유 서술에 충분한 500자 상한.
    .isLength({ max: 500 })
    .withMessage("reason은 최대 500자여야 합니다."),
];

// ─── POST /api/admin/event-series/:seriesId/cancel body ──────────────────────

const cancelSeriesBodyValidator = [
  body("from")
    .optional()
    .isISO8601()
    .withMessage("from은 ISO8601 형식이어야 합니다."),
];

// ─── GET /api/events/:eventId/seats/stream 쿼리 ─────────────────────────────

const eventSeatsStreamQueryValidator = [
  ...eventIdParamValidator,
  ...sessionIdQueryValidator,
];

// ─── GET /api/events/:eventId/queue/stream 쿼리 ─────────────────────────────

const eventQueueStreamQueryValidator = [
  ...eventIdParamValidator,
  ...sessionIdQueryValidator,
];

// ─── GET /api/admin/events/:eventId/registrations 쿼리 ──────────────────────

const adminListRegistrationsQueryValidator = [
  query("status")
    .optional()
    .isIn(VALID_REG_STATUSES)
    .withMessage(`status는 ${VALID_REG_STATUSES.join("|")} 중 하나여야 합니다.`),
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("page는 1 이상의 정수여야 합니다."),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 200 })
    .withMessage("limit은 1~200 범위의 정수여야 합니다."),
];

export {
  eventIdParamValidator,
  seriesIdParamValidator,
  listEventsQueryValidator,
  adminListEventsQueryValidator,
  calendarQueryValidator,
  listMyRegistrationsQueryValidator,
  latestRankingsQueryValidator,
  createEventBodyValidator,
  createSeriesBodyValidator,
  updateEventBodyValidator,
  cancelEventBodyValidator,
  cancelSeriesBodyValidator,
  adminListRegistrationsQueryValidator,
  eventSeatsStreamQueryValidator,
  eventQueueStreamQueryValidator,
};
