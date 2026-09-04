import { body, param, query } from "express-validator";

const VALID_KINDS = ["notice", "update", "fix"] as const;

const noticeIdParamValidator = [
  param("id")
    .isInt({ min: 1, max: 2147483647 })
    .withMessage("id는 1 이상의 정수여야 합니다."),
];

const listNoticesQueryValidator = [
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit은 1~100 사이의 정수여야 합니다."),
];

const listAdminNoticesQueryValidator = [
  query("page").optional().isInt({ min: 1 }).withMessage("page는 1 이상의 정수여야 합니다."),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 200 })
    .withMessage("limit은 1~200 사이의 정수여야 합니다."),
];

const createNoticeBodyValidator = [
  body("kind")
    .isIn(VALID_KINDS)
    .withMessage(`kind는 ${VALID_KINDS.join("|")} 중 하나여야 합니다.`),
  body("title")
    .trim()
    .notEmpty()
    .withMessage("title은 필수입니다.")
    .isLength({ min: 1, max: 120 })
    .withMessage("title은 1~120자여야 합니다."),
  body("content")
    .optional()
    .isString()
    .isLength({ max: 10000 })
    .withMessage("content는 최대 10000자입니다."),
];

const updateNoticeBodyValidator = [
  body("kind")
    .optional()
    .isIn(VALID_KINDS)
    .withMessage(`kind는 ${VALID_KINDS.join("|")} 중 하나여야 합니다.`),
  body("title")
    .optional()
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage("title은 1~120자여야 합니다."),
  body("content")
    .optional()
    .isString()
    .isLength({ max: 10000 })
    .withMessage("content는 최대 10000자입니다."),
];

export {
  noticeIdParamValidator,
  listNoticesQueryValidator,
  listAdminNoticesQueryValidator,
  createNoticeBodyValidator,
  updateNoticeBodyValidator,
};
