import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import * as practiceService from "../services/practice.service";
import * as usersService from "../services/users.service";
import { validationResult } from "express-validator";
import { AppError } from "../middlewares/errorHandler";
import config from "../config";

const GUEST_UUID_COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000;

const setGuestCookie = (res: Response, guestUuid: string) => {
  res.cookie("guest_uuid", guestUuid, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "strict",
    maxAge: GUEST_UUID_COOKIE_MAX_AGE,
    path: "/",
  });
};

const startSession = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(422, "VALIDATION_ERROR", errors.array()[0].msg));
  }

  const { mode, nickname, eventId } = req.body;
  const userId = req.user?.id;

  let guestUuid: string | undefined;
  if (!userId) {
    guestUuid = req.cookies?.guest_uuid as string | undefined;
    if (!guestUuid) {
      // 신규 게스트: UUID 발급 + 쿠키 세팅. 닉네임은 필수.
      if (!nickname) {
        throw new AppError(
          400,
          "NICKNAME_REQUIRED",
          "비로그인 유저는 닉네임이 필요합니다.",
        );
      }
      guestUuid = randomUUID();
      setGuestCookie(res, guestUuid);
    }
  }

  let resolvedNickname = nickname;
  if (userId) {
    const user = await usersService.getMe(userId);
    resolvedNickname = user.name;
  }

  const session = await practiceService.startSession({
    userId,
    guestUuid,
    nickname: resolvedNickname,
    mode,
    eventId: eventId !== undefined ? Number(eventId) : undefined,
  });

  res.status(201).json({
    success: true,
    data: {
      sessionId: session.session_id,
      startedAt: session.started_at,
      nickname: session.nickname,
    },
  });
};

const completeSession = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(422, "VALIDATION_ERROR", errors.array()[0].msg));
  }

  const sessionId = req.params.sessionId as string;
  const userId = req.user?.id;
  const guestUuid = !userId
    ? (req.cookies?.guest_uuid as string | undefined)
    : undefined;

  if (!userId && !guestUuid) {
    throw new AppError(
      401,
      "GUEST_UUID_MISSING",
      "게스트 인증 정보가 없습니다. 세션을 먼저 시작해주세요.",
    );
  }

  const result = await practiceService.completeSession({
    sessionId,
    userId,
    guestUuid,
  });

  res.status(200).json({ success: true, data: result });
};

export { startSession, completeSession };
