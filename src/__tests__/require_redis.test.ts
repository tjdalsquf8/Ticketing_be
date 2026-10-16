import type { Request, Response } from "express";
import { redis } from "../config/redis";
import requireRedis from "../middlewares/requireRedis";
import { AppError } from "../middlewares/errorHandler";

const call = () => {
  const next = jest.fn();
  requireRedis({} as Request, {} as Response, next);
  return next;
};

describe("requireRedis", () => {
  const original = redis.status;
  afterEach(() => {
    Object.defineProperty(redis, "status", { value: original, configurable: true });
  });

  it("Redis가 ready가 아니면 503 REDIS_UNAVAILABLE", () => {
    Object.defineProperty(redis, "status", { value: "reconnecting", configurable: true });
    const err = call().mock.calls[0][0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(503);
    expect(err.code).toBe("REDIS_UNAVAILABLE");
  });

  it("Redis가 ready면 통과", () => {
    Object.defineProperty(redis, "status", { value: "ready", configurable: true });
    expect(call()).toHaveBeenCalledWith();
  });
});
