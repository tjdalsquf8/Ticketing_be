import { body } from "express-validator";

/**
 * POST /api/guests body
 *
 * 규칙은 practice.validator 의 nickname 과 동일하게 맞춘다 (2~10자 + 화이트리스트).
 * 프론트도 같은 규칙을 강제하지만 그건 UX 용이라 curl 로 그냥 우회된다.
 * 길이만 검사하면 공백·이모지·제로폭 문자(U+200B)가 그대로 등록돼,
 * `김철수` 와 `김철수<U+200B>` 처럼 눈으로 구분 안 되는 닉네임을 만들 수 있다.
 * React 가 이스케이프하므로 XSS 는 아니지만 시각적 사칭 도구가 된다.
 */
const postGuestValidator = [
  body("nickname")
    .optional()
    .trim()
    .isLength({ min: 2, max: 10 }).withMessage("닉네임은 2~10자여야 합니다.")
    .matches(/^[가-힣a-zA-Z0-9_-]+$/)
    .withMessage("닉네임은 한글, 영문, 숫자, _, - 만 사용 가능합니다."),
];

export { postGuestValidator };
