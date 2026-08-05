import { Request, Response, NextFunction } from "express";
import * as practiceService from "../services/practice.service";
import * as usersService from "../services/users.service";
import { validationResult } from "express-validator";
import { AppError } from "../middlewares/errorHandler";

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
  const guestUuid = req.headers["x-guest-uuid"] as string | undefined;

  if (!userId && !guestUuid) {
    throw new AppError(
      400,
      "GUEST_UUID_REQUIRED",
      "비로그인 유저는 X-Guest-UUID 헤더가 필요합니다.",
    );
  }

  if (!userId && !nickname) {
    throw new AppError(
      400,
      "NICKNAME_REQUIRED",
      "비로그인 유저는 닉네임이 필요합니다.",
    );
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
    data: { sessionId: session.session_id, startedAt: session.started_at },
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
  const guestUuid = req.headers["x-guest-uuid"] as string | undefined;

  const result = await practiceService.completeSession({
    sessionId,
    userId,
    guestUuid,
  });

  res.status(200).json({ success: true, data: result });
};

export { startSession, completeSession };
