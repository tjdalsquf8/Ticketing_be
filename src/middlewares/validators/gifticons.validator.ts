import { body, param, query } from "express-validator";

const VALID_CATEGORIES = ["coffee", "food", "convenience", "beauty", "etc"] as const;
const VALID_STATUSES = ["available", "issued", "redeemed", "expired"] as const;

const gifticonIdParamValidator = [
  param("id")
    .isInt({ min: 1, max: 2147483647 })
    .withMessage("id는 1 이상의 정수여야 합니다."),
];

const listGifticonsQueryValidator = [
  query("category")
    .optional()
    .isIn(VALID_CATEGORIES)
    .withMessage(`category는 ${VALID_CATEGORIES.join("|")} 중 하나여야 합니다.`),
  query("status")
    .optional()
    .isIn(VALID_STATUSES)
    .withMessage(`status는 ${VALID_STATUSES.join("|")} 중 하나여야 합니다.`),
  query("q")
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage("q는 최대 100자입니다."),
  query("page").optional().isInt({ min: 1 }).withMessage("page는 1 이상의 정수여야 합니다."),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 200 })
    .withMessage("limit은 1~200 사이의 정수여야 합니다."),
];

const createGifticonBodyValidator = [
  body("category")
    .isIn(VALID_CATEGORIES)
    .withMessage(`category는 ${VALID_CATEGORIES.join("|")} 중 하나여야 합니다.`),
  body("productName")
    .trim()
    .notEmpty()
    .withMessage("productName은 필수입니다.")
    .isLength({ min: 1, max: 80 })
    .withMessage("productName은 1~80자여야 합니다."),
  body("faceValue")
    .isInt({ min: 1, max: 2147483647 })
    .withMessage("faceValue는 0보다 큰 정수여야 합니다."),
  body("code")
    .trim()
    .notEmpty()
    .withMessage("code는 필수입니다.")
    .isLength({ min: 8, max: 64 })
    .withMessage("code는 8~64자여야 합니다."),
];

const updateGifticonBodyValidator = [
  body("productName")
    .optional()
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage("productName은 1~80자여야 합니다."),
  body("faceValue")
    .optional()
    .isInt({ min: 1, max: 2147483647 })
    .withMessage("faceValue는 0보다 큰 정수여야 합니다."),
  body("code")
    .optional()
    .trim()
    .isLength({ min: 8, max: 64 })
    .withMessage("code는 8~64자여야 합니다."),
];

export {
  gifticonIdParamValidator,
  listGifticonsQueryValidator,
  createGifticonBodyValidator,
  updateGifticonBodyValidator,
};
