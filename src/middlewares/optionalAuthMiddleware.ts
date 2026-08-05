import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import config from "../config";

const optionalAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const token =
    req.cookies?.accessToken ?? req.headers.authorization?.split(" ")[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as { id: number; email: string };
      req.user = decoded;
    } catch {
      // 토큰이 유효하지 않아도 통과
    }
  }

  next();
};

export default optionalAuthMiddleware;
