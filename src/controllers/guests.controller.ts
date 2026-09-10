import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { validationResult } from "express-validator";
import * as guestsService from "../services/guests.service";
import { AppError } from "../middlewares/errorHandler";
import { setGuestCookie } from "../utils/guestCookie";

/**
 * POST /api/guests
 *
 * 게스트 UUID를 발급하고 guest_uuid HttpOnly 쿠키에 세팅한다.
 * - 쿠키 없음: 신규 UUID 발급 후 guests 테이블에 INSERT
 * - 쿠키 있음: 기존 UUID 유지, body에 nickname이 오면 guests 테이블 UPDATE로 반영
 * Body: { nickname?: string } — 선택적, 2~10자 + [가-힣a-zA-Z0-9_-]
 */
const postGuest = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError(422, "VALIDATION_ERROR", errors.array()[0].msg));
    }

    const existingUuid = req.cookies?.guest_uuid as string | undefined;
    const nickname = (req.body?.nickname as string | undefined) ?? "익명유저";

    if (existingUuid) {
      // 기존 UUID 유지. body에 nickname이 오면 DB에 반영 (upsert)
      await guestsService.upsertGuest(existingUuid, nickname);
      return res.status(201).json({
        success: true,
        data: { guestUuid: existingUuid, nickname },
      });
    }

    const guestUuid = randomUUID();
    await guestsService.upsertGuest(guestUuid, nickname);
    setGuestCookie(res, guestUuid);

    return res.status(201).json({
      success: true,
      data: { guestUuid, nickname },
    });
  } catch (err) {
    next(err);
  }
};

const getMe = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const guestUuid = req.cookies?.guest_uuid as string | undefined;
    if (!guestUuid) {
      throw new AppError(401, "GUEST_NOT_AUTHENTICATED", "guest_uuid 쿠키가 없습니다. POST /api/guests 로 게스트 세션을 먼저 시작하세요.");
    }

    const guest = await guestsService.getMe(guestUuid);
    if (!guest) {
      throw new AppError(404, "GUEST_NOT_FOUND", "게스트 정보를 찾을 수 없습니다.");
    }

    res.status(200).json({ success: true, data: guest });
  } catch (err) {
    next(err);
  }
};

export { postGuest, getMe };
