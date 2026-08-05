import { body } from "express-validator";

const registerValidator = [
  body("email").isEmail().withMessage("이메일 형식이 아닙니다"),
  body("password")
    .isLength({ min: 8 })
    .withMessage("비밀번호는 최소 8자 이상이어야 합니다"),
  body("name")
    .trim()
    .notEmpty().withMessage("이름은 필수 입력 항목입니다")
    .isLength({ min: 2, max: 12 }).withMessage("이름은 2~12자여야 합니다.")
    .matches(/^[가-힣a-zA-Z0-9_-]+$/)
    .withMessage("이름은 한글, 영문, 숫자, _, - 만 사용 가능합니다."),
];

const loginValidator = [
  body("email").isEmail().withMessage("이메일 형식이 아닙니다"),
  body("password").notEmpty().withMessage("비밀번호는 필수 입력 항목입니다"),
];

export { registerValidator, loginValidator };
