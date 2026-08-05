import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import config from "../config";
import { AppError } from "./errorHandler";

const authMiddleware = (req: Request, _res: Response, next: NextFunction) => {
  const token =
    req.cookies?.accessToken ?? req.headers.authorization?.split(" ")[1];

  if (!token) {
    return next(new AppError(401, "AUTH_TOKEN_MISSING", "토큰이 없습니다."));
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as {
      id: number;
      email: string;
    };
    req.user = decoded;
    next();
  } catch {
    next(new AppError(401, "AUTH_INVALID_TOKEN", "유효하지 않은 토큰입니다."));
  }
};

export default authMiddleware;
