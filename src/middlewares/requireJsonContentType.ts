import { Request, Response, NextFunction } from "express";
import { AppError } from "./errorHandler";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function requireJsonContentType(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (!WRITE_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  const contentLength = req.headers["content-length"];
  if (!contentLength || contentLength === "0") {
    return next();
  }

  const contentType = (req.headers["content-type"] || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return next(
      new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "잘못된 요청 형식입니다."),
    );
  }

  next();
}
