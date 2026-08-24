import { body } from "express-validator";

/** POST /api/guests body */
const postGuestValidator = [
  body("nickname")
    .optional()
    .trim()
    .isLength({ min: 1, max: 30 })
    .withMessage("nickname은 1~30자여야 합니다."),
];

export { postGuestValidator };
