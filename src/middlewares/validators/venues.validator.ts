import { param } from "express-validator";

/** slug 경로 파라미터 */
const slugParamValidator = [
  param("slug")
    .isString()
    .isLength({ min: 1, max: 50 })
    .matches(/^[a-z0-9-]+$/)
    .withMessage("slug 형식이 올바르지 않습니다."),
];

export { slugParamValidator };
