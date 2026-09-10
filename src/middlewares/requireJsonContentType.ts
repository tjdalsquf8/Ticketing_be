import { Request, Response, NextFunction } from "express";
import { AppError } from "./errorHandler";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * 상태 변경 요청은 JSON Content-Type 을 강제한다 (SameSite 쿠키와 함께 CSRF 2층 방어).
 *
 * 판정 기준은 본문 길이가 아니라 **Content-Type 헤더의 존재 여부**다.
 * 예전에는 `content-length` 가 없거나 0 이면 검사를 통째로 건너뛰었는데,
 * HTML form 은 필드가 하나도 없어도 `application/x-www-form-urlencoded` 를 붙여
 * 본문 0바이트로 전송할 수 있다. 그래서 본문이 전부 선택 값인 엔드포인트
 * (예: POST /api/guests)는 입력 필드 없는 cross-site form 자동 제출로 그냥 통과했다.
 *
 * 지금은 Content-Type 이 붙어 있으면 본문 길이와 무관하게 JSON 인지 검사하므로
 * form 기반 cross-site POST 는 전부 415 로 막힌다. Content-Type 자체가 없고 본문도
 * 없는 요청(본문 없는 fetch/XHR, curl -X POST)만 통과시킨다 — form 으로는 이 조합을
 * 만들 수 없다.
 */
export function requireJsonContentType(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (!WRITE_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  const contentType = (req.headers["content-type"] || "").toLowerCase();
  const contentLength = req.headers["content-length"];
  const hasBody = Boolean(contentLength) && contentLength !== "0";

  if (!contentType && !hasBody) {
    return next();
  }

  if (!contentType.includes("application/json")) {
    return next(
      new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "잘못된 요청 형식입니다."),
    );
  }

  next();
}
