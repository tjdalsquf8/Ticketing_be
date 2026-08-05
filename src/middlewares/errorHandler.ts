import { Request, Response, NextFunction } from "express";
import config from "../config";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
    return;
  }

  if (config.nodeEnv !== "production") {
    console.error("[UNEXPECTED ERROR]", err);
  } else {
    console.error(
      "[UNEXPECTED ERROR]",
      err instanceof Error ? err.message : "unknown error",
    );
  }

  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "일시적인 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
    },
  });
}
