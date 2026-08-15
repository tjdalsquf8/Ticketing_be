import { body, param, query } from "express-validator";

const SEAT_LABEL_PATTERN = /^[A-Za-z0-9가-힣_-]+$/;

const seatLabelsValidator = (value: unknown): true => {
  if (!Array.isArray(value)) {
    throw new Error("seatLabels는 배열이어야 합니다.");
  }
  if (value.length < 1 || value.length > 2000) {
    throw new Error("seatLabels는 1~2000개여야 합니다.");
  }
  const seen = new Set<string>();
  for (const label of value) {
    if (typeof label !== "string") {
      throw new Error("seatLabels 각 원소는 문자열이어야 합니다.");
    }
    if (label.length < 1 || label.length > 32) {
      throw new Error("seat_label은 1~32자여야 합니다.");
    }
    if (!SEAT_LABEL_PATTERN.test(label)) {
      throw new Error(
        "seat_label은 영문/숫자/한글/_/- 만 사용 가능합니다.",
      );
    }
    if (seen.has(label)) {
      throw new Error("중복된 seat_label이 있습니다.");
    }
    seen.add(label);
  }
  return true;
};

const excludedHoursValidator = (value: unknown): true => {
  if (!Array.isArray(value)) {
    throw new Error("excludedHours는 배열이어야 합니다.");
  }
  if (value.length > 24) {
    throw new Error("excludedHours는 최대 24개입니다.");
  }
  const seen = new Set<number>();
  for (const h of value) {
    if (!Number.isInteger(h) || h < 0 || h > 23) {
      throw new Error("excludedHours 각 원소는 0~23 정수여야 합니다.");
    }
    if (seen.has(h as number)) {
      throw new Error("excludedHours에 중복된 시간이 있습니다.");
    }
    seen.add(h as number);
  }
  return true;
};

const putConfigEventValidator = [
  body("defaultEventId")
    .notEmpty().withMessage("defaultEventId는 필수입니다.")
    .isInt({ min: 1 }).withMessage("defaultEventId는 1 이상의 정수여야 합니다."),
  body("defaultSeatLabels").custom(seatLabelsValidator),
];

const putConfigScheduleValidator = [
  body("excludedHours").custom(excludedHoursValidator),
];

const listRoundsValidator = [
  query("from").optional().isISO8601().withMessage("from은 ISO8601 형식이어야 합니다."),
  query("to").optional().isISO8601().withMessage("to는 ISO8601 형식이어야 합니다."),
  query("date")
    .optional()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage("date는 YYYY-MM-DD 형식이어야 합니다."),
  // date 와 from/to 를 동시 전송하면 서비스 레이어에서 date 만 사용하고 from/to 는 조용히 무시됨
  // → 클라이언트 의도와 결과가 어긋나 디버깅 어려운 버그로 이어짐. 명시적으로 400 으로 컷.
  query("date").custom((value, { req }) => {
    if (value !== undefined && (req.query?.from !== undefined || req.query?.to !== undefined)) {
      throw new Error("date와 from/to는 함께 사용할 수 없습니다.");
    }
    return true;
  }),
];

const roundIdParamValidator = [
  param("roundId").isInt({ min: 1 }).withMessage("roundId는 1 이상의 정수여야 합니다."),
];

export {
  putConfigEventValidator,
  putConfigScheduleValidator,
  listRoundsValidator,
  roundIdParamValidator,
};
