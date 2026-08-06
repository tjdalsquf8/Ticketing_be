import { body } from "express-validator";

const startSessionValidator = [
  body("mode")
    .notEmpty().withMessage("mode는 필수입니다.")
    .isIn(["practice", "live"]).withMessage("mode는 practice 또는 live여야 합니다."),
  body("nickname")
    .optional()
    .trim()
    .isLength({ min: 2, max: 12 }).withMessage("닉네임은 2~12자여야 합니다.")
    .matches(/^[가-힣a-zA-Z0-9_-]+$/)
    .withMessage("닉네임은 한글, 영문, 숫자, _, - 만 사용 가능합니다."),
  body("eventId").optional().isInt({ min: 1 }).withMessage("eventId는 1 이상의 정수여야 합니다."),
];

const completeSessionValidator = [
  body("clientElapsedMs")
    .notEmpty().withMessage("clientElapsedMs는 필수입니다.")
    .isInt({ min: 0 }).withMessage("clientElapsedMs는 0 이상의 정수여야 합니다."),
];

export { startSessionValidator, completeSessionValidator };
