import { query, param } from "express-validator";

/** GET /me — page / limit 쿼리 파라미터 검증 */
const getMyTicketsQueryValidator = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("page는 1 이상의 정수여야 합니다."),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit는 1~100 사이의 정수여야 합니다."),
];

/** GET /:ticketId — ticketId 경로 파라미터 검증 */
const ticketIdParamValidator = [
  param("ticketId")
    .isInt({ min: 1 })
    .withMessage("ticketId는 1 이상의 정수여야 합니다."),
];

export { getMyTicketsQueryValidator, ticketIdParamValidator };
