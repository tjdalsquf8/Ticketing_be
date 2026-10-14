import { query } from "express-validator";

const getRankingsValidator = [
  query("mode")
    .notEmpty().withMessage("mode는 필수입니다.")
    .isIn(["practice", "live"]).withMessage("mode는 practice, live 중 하나여야 합니다."),
  query("period")
    .notEmpty().withMessage("period는 필수입니다.")
    .isIn(["daily", "weekly", "monthly", "all"]).withMessage("period는 daily, weekly, monthly, all 중 하나여야 합니다."),
  query("page")
    .optional()
    .isInt({ min: 1 }).withMessage("page는 1 이상의 정수여야 합니다."),
  query("size")
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage("size는 1~100 사이의 정수여야 합니다."),
  query("eventId").optional().isInt({ min: 1 }).withMessage("eventId는 1 이상의 정수여야 합니다."),
];

// GET /api/rankings/me — 전체 랭킹과 동일한 필터를 받되 ticket 모드가 없고 인증 필수.
const getMyRankingsValidator = [
  query("mode")
    .notEmpty().withMessage("mode는 필수입니다.")
    .isIn(["practice", "live"]).withMessage("mode는 practice, live 중 하나여야 합니다."),
  query("period")
    .notEmpty().withMessage("period는 필수입니다.")
    .isIn(["daily", "weekly", "monthly", "all"]).withMessage("period는 daily, weekly, monthly, all 중 하나여야 합니다."),
  query("page")
    .optional()
    .isInt({ min: 1 }).withMessage("page는 1 이상의 정수여야 합니다."),
  query("size")
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage("size는 1~100 사이의 정수여야 합니다."),
  query("eventId").optional().isInt({ min: 1 }).withMessage("eventId는 1 이상의 정수여야 합니다."),
];

// GET /api/rankings/me/best — 인증 불필요, page/size 없음
const getMyBestRankingValidator = [
  query("mode")
    .notEmpty().withMessage("mode는 필수입니다.")
    .isIn(["practice", "live"]).withMessage("mode는 practice, live 중 하나여야 합니다."),
  query("period")
    .notEmpty().withMessage("period는 필수입니다.")
    .isIn(["daily", "weekly", "monthly", "all"]).withMessage("period는 daily, weekly, monthly, all 중 하나여야 합니다."),
  query("eventId").optional().isInt({ min: 1 }).withMessage("eventId는 1 이상의 정수여야 합니다."),
];

export { getRankingsValidator, getMyRankingsValidator, getMyBestRankingValidator };
