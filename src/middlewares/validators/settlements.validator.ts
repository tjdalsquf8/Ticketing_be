import { body, param, query } from "express-validator";

const VALID_STATUSES = ["pending", "issued"] as const;

const settlementIdParamValidator = [
  param("id")
    .matches(/^st-\d+$/)
    .withMessage("id는 st-{ticketId} 형식이어야 합니다."),
];

const listSettlementsQueryValidator = [
  query("status")
    .optional()
    .isIn(VALID_STATUSES)
    .withMessage(`status는 ${VALID_STATUSES.join("|")} 중 하나여야 합니다.`),
  query("eventId")
    .optional()
    .isInt({ min: 1, max: 2147483647 })
    .withMessage("eventId는 1 이상의 정수여야 합니다."),
  query("page").optional().isInt({ min: 1 }).withMessage("page는 1 이상의 정수여야 합니다."),
  query("size")
    .optional()
    .isInt({ min: 1, max: 200 })
    .withMessage("size는 1~200 사이의 정수여야 합니다."),
];

const issueSettlementBodyValidator = [
  body("gifticonId")
    .isInt({ min: 1, max: 2147483647 })
    .withMessage("gifticonId는 1 이상의 정수여야 합니다."),
];

export {
  settlementIdParamValidator,
  listSettlementsQueryValidator,
  issueSettlementBodyValidator,
};
