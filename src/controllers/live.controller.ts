import { NextFunction, Request, Response } from "express";
import { validationResult } from "express-validator";
import * as liveService from "../services/live.service";
import { AppError } from "../middlewares/errorHandler";

// GET /api/live/current — 지금 진행중 회차 (없으면 null)
const getCurrent = async (_req: Request, res: Response) => {
  const data = await liveService.getCurrent();
  res.status(200).json({ success: true, data });
};

// GET /api/live/next — 다음 예정 회차 (없으면 null)
const getNext = async (_req: Request, res: Response) => {
  const data = await liveService.getNext();
  res.status(200).json({ success: true, data });
};

// GET /api/live/last-round?limit=N — 가장 최근 종료 회차 + 상위 N명 랭킹
const getLastRound = async (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(422, "VALIDATION_ERROR", errors.array()[0].msg));
  }

  try {
    const rawLimit = Number(req.query.limit);
    const limit =
      Number.isFinite(rawLimit) && rawLimit >= 1
        ? Math.min(Math.floor(rawLimit), 30)
        : 10;
    const data = await liveService.getLastRoundTopN(limit);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// GET /api/live/rounds/:roundId — 특정 회차 상세 조회 (공개, 인증 불필요)
const getRoundById = async (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(422, "VALIDATION_ERROR", errors.array()[0].msg));
  }

  try {
    const roundId = parseInt(req.params["roundId"] as string, 10);
    const data = await liveService.getRoundById(roundId);

    if (data === null) {
      return next(new AppError(404, "ROUND_NOT_FOUND", "존재하지 않는 회차입니다."));
    }

    // 이미 참여한 회차를 다시 열었을 때 프론트가 진입 버튼을 사전 차단할 수 있도록
    // 요청자 기준 참여 여부를 함께 싣는다. 라우터의 optionalAuthMiddleware 가
    // req.user 를 채워두므로 비로그인은 guest_uuid 쿠키로만 식별한다.
    // 게스트 식별은 httpOnly 쿠키만 신뢰한다 (참여 API 와 동일 정책).
    const userId = req.user?.id ?? null;
    const guestUuid =
      userId == null ? (req.cookies?.guest_uuid as string | undefined) : undefined;
    const myParticipation = await liveService.getMyParticipation(roundId, {
      userId,
      guestUuid,
    });

    res.status(200).json({ success: true, data: { ...data, myParticipation } });
  } catch (err) {
    next(err);
  }
};

export { getCurrent, getNext, getLastRound, getRoundById };
