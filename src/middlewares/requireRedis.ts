import { Request, Response, NextFunction } from "express";
import { redis } from "../config/redis";
import { AppError } from "./errorHandler";

/**
 * Redis 연결이 ready가 아니면 요청을 즉시 503으로 거절한다 (fail-fast).
 * 끊긴 동안 ioredis 오프라인 큐에 명령이 쌓여 요청이 매달리는 것을 막는다.
 */
export default function requireRedis(_req: Request, _res: Response, next: NextFunction) {
  if (redis.status !== "ready") {
    next(
      new AppError(503, "REDIS_UNAVAILABLE", "서버가 잠시 혼잡합니다. 잠시 후 다시 시도해주세요."),
    );
    return;
  }
  next();
}
