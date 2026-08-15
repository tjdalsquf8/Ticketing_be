import { Request, Response, NextFunction } from "express";
import pool from "../config/db";
import { AppError } from "./errorHandler";

const requireAdmin = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const userId = req.user?.id;
  if (!userId) {
    return next(new AppError(401, "AUTH_TOKEN_MISSING", "로그인이 필요합니다."));
  }

  try {
    const result = await pool.query(
      "SELECT role FROM users WHERE id = $1",
      [userId],
    );
    if (result.rows[0]?.role !== "admin") {
      return next(new AppError(403, "NOT_ADMIN", "관리자 권한이 필요합니다."));
    }
    next();
  } catch (err) {
    next(err);
  }
};

export default requireAdmin;
