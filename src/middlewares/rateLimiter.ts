import rateLimit from "express-rate-limit";

// 테스트 환경에서는 rate limit를 스킵 (다수 요청이 짧은 시간에 발생)
const skipInTest = () => process.env.NODE_ENV === "test";

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: {
    error: "TOO_MANY_LOGIN_ATTEMPTS",
    message: "로그인 시도가 너무 많습니다. 15분 후 다시 시도해주세요.",
  },
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: {
    error: "TOO_MANY_REGISTER_ATTEMPTS",
    message: "회원가입 시도가 너무 많습니다. 1시간 후 다시 시도해주세요.",
  },
});

export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: {
    error: "TOO_MANY_REFRESH_ATTEMPTS",
    message: "토큰 갱신 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  },
});

export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: {
    error: "TOO_MANY_REQUESTS",
    message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  },
});
