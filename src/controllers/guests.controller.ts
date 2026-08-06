import { Request, Response } from "express";
import * as guestsService from "../services/guests.service";
import { AppError } from "../middlewares/errorHandler";

const getMe = async (req: Request, res: Response) => {
  const guestUuid = req.cookies?.guest_uuid as string | undefined;
  if (!guestUuid) {
    throw new AppError(404, "GUEST_NOT_FOUND", "게스트 정보를 찾을 수 없습니다.");
  }

  const guest = await guestsService.getMe(guestUuid);
  if (!guest) {
    throw new AppError(404, "GUEST_NOT_FOUND", "게스트 정보를 찾을 수 없습니다.");
  }

  res.status(200).json({ success: true, data: guest });
};

// 게스트 정체성 초기화 (닉네임 변경 시 사용)
// - guest_uuid 쿠키 삭제 → 다음 세션 시작 시 새 UUID 발급됨
// - 기존 세션 데이터는 DB에 남아있으며 30일 후 크론이 정리 (유령 UUID)
const deleteMe = (_req: Request, res: Response) => {
  res.clearCookie("guest_uuid", { path: "/" });
  res.status(200).json({ success: true, data: null });
};

export { getMe, deleteMe };
