import { Request, Response, NextFunction } from "express";
import * as authService from "../services/auth.service";
import { validationResult } from "express-validator";
import config from "../config";
import { AppError } from "../middlewares/errorHandler";

const register = async (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(422, "VALIDATION_ERROR", errors.array()[0].msg));
  }

  const { email, password, name } = req.body;
  const user = await authService.register(email, password, name);
  res.status(201).json({
    success: true,
    data: { userId: user.id, email: user.email, name: user.name },
  });
};

const login = async (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(422, "VALIDATION_ERROR", errors.array()[0].msg));
  }

  const { email, password } = req.body;
  const { accessToken, refreshToken, userInfo } = await authService.login(
    email,
    password,
  );
  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "strict",
    maxAge: 60 * 60 * 1000,
    path: "/",
  });
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  res.status(200).json({ success: true, data: { userInfo } });
};

const refresh = async (req: Request, res: Response) => {
  const oldRefreshToken = req.cookies.refreshToken;
  if (!oldRefreshToken) {
    throw new AppError(401, "AUTH_INVALID_TOKEN", "refreshToken이 없습니다.");
  }
  const { accessToken, refreshToken } = await authService.refresh(
    oldRefreshToken,
  );
  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "strict",
    maxAge: 60 * 60 * 1000,
    path: "/",
  });
  // refresh 도 매 호출마다 새 값으로 교체 (rotation). 이전 refresh 는 서버 hash 교체로 자동 무효.
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  res.status(200).json({ success: true, data: null });
};

const logout = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await authService.logout(userId);
  res.clearCookie("refreshToken");
  res.clearCookie("accessToken");
  res.status(200).json({ success: true, data: null });
};

export { register, login, logout, refresh };
