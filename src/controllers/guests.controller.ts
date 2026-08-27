import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { validationResult } from "express-validator";
import * as guestsService from "../services/guests.service";
import { AppError } from "../middlewares/errorHandler";
import config from "../config";

const GUEST_UUID_COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000;

const setGuestCookie = (res: Response, guestUuid: string) => {
  res.cookie("guest_uuid", guestUuid, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    maxAge: GUEST_UUID_COOKIE_MAX_AGE,
    path: "/",
  });
};

/**
 * POST /api/guests
 *
 * 게스트 UUID를 발급하고 guest_uuid HttpOnly 쿠키에 세팅한다.
 * - 쿠키 없음: 신규 UUID 발급 후 guests 테이블에 INSERT
 * - 쿠키 있음: 기존 UUID 유지, body에 nickname이 오면 guests 테이블 UPDATE로 반영
 * Body: { nickname?: string } — 선택적, 1~30자
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

// 게스트 정체성 초기화 (닉네임 변경 시 사용)
// - guest_uuid 쿠키 삭제 → 다음 세션 시작 시 새 UUID 발급됨
// - 기존 세션 데이터는 DB에 남아있으며 30일 후 크론이 정리 (유령 UUID)
//
// 랭킹 조작 방지: 마지막 닉네임 변경 후 1시간 이내 재변경(= 쿠키 리셋 요청) 차단.
// httpOnly 쿠키 정책상 프론트 UI 로 정상 flow 는 이미 막혀 있으나 개발자도구·직접
// API 호출 우회에 대비해 서버가 최종 방어선을 제공한다.
const NICKNAME_CHANGE_COOLDOWN_MS = 60 * 60 * 1000; // 1시간

const deleteMe = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const guestUuid = req.cookies?.guest_uuid as string | undefined;

    // 쿠키가 이미 없으면 idempotent 하게 200. 아무 것도 삭제할 것 없음.
    if (!guestUuid) {
      return res.status(200).json({ success: true, data: null });
    }

    const nicknameChangedAt = await guestsService.getNicknameChangedAt(guestUuid);

    // guests row 가 없다 = 이미 크론이 정리한 유령. 쿠키만 정리하고 통과.
    if (nicknameChangedAt !== null) {
      const elapsedMs = Date.now() - nicknameChangedAt.getTime();
      if (elapsedMs < NICKNAME_CHANGE_COOLDOWN_MS) {
        const retryAfterSeconds = Math.ceil((NICKNAME_CHANGE_COOLDOWN_MS - elapsedMs) / 1000);
        res.setHeader("Retry-After", retryAfterSeconds.toString());
        return next(
          new AppError(
            429,
            "NICKNAME_CHANGE_TOO_SOON",
            `닉네임 변경은 최소 1시간 후 가능합니다. ${retryAfterSeconds}초 후 다시 시도해주세요.`,
          ),
        );
      }
    }

    res.clearCookie("guest_uuid", { path: "/" });
    res.status(200).json({ success: true, data: null });
  } catch (err) {
    next(err);
  }
};

export { postGuest, getMe, deleteMe };
