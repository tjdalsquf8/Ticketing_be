import { Request, Response, NextFunction } from "express";
import * as rankingsService from "../services/rankings.service";
import { validationResult } from "express-validator";
import { AppError } from "../middlewares/errorHandler";

const getRankings = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(422, "VALIDATION_ERROR", errors.array()[0].msg));
  }

  const mode = req.query.mode as string;
  const period = req.query.period as string;
  const page = parseInt(req.query.page as string) || 1;
  const size = parseInt(req.query.size as string) || 20;
  const eventId =
    req.query.eventId !== undefined
      ? parseInt(req.query.eventId as string)
      : undefined;

  const { data, total } = await rankingsService.getRankings({
    mode,
    period,
    page,
    size,
    eventId,
  });

  res.status(200).json({
    success: true,
    data,
    meta: { page, size, totalCount: total },
  });
};

/**
 * 요청자 identity 를 해석한다 — 로그인 유저면 user id, 아니면 guest_uuid 쿠키.
 * 세션 테이블의 `COALESCE(user_id::text, guest_uuid)` 와 같은 형식이어야 한다.
 * 둘 다 없으면 null (조회 대상 없음).
 */
function resolveIdentity(req: Request): string | null {
  if (req.user?.id != null) return String(req.user.id);
  return (req.cookies?.guest_uuid as string | undefined) ?? null;
}

// GET /api/rankings/me — 본인의 시도별 기록 전체 (로그인 유저 + 게스트, 인증 불필요).
// identity 로 묶으므로 게스트가 닉네임을 바꿔도 이전 닉네임으로 낸 시도까지 전부 남는다.
const getMyRankings = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(422, "VALIDATION_ERROR", errors.array()[0].msg));
  }

  const mode = req.query.mode as string;
  const period = req.query.period as string;
  const page = parseInt(req.query.page as string) || 1;
  const size = parseInt(req.query.size as string) || 20;
  const eventId =
    req.query.eventId !== undefined
      ? parseInt(req.query.eventId as string)
      : undefined;

  const identity = resolveIdentity(req);
  if (identity === null) {
    // 로그인도 게스트 쿠키도 없음 = 아직 아무 기록도 없는 방문자.
    // 에러가 아니라 빈 목록으로 응답해 프론트가 탭을 그대로 렌더할 수 있게 한다.
    return res.status(200).json({
      success: true,
      data: [],
      meta: { page, size, totalCount: 0 },
    });
  }

  const { data, total } = await rankingsService.getMyRankings({
    identity,
    mode,
    period,
    page,
    size,
    eventId,
  });

  res.status(200).json({
    success: true,
    data,
    meta: { page, size, totalCount: total },
  });
};

// GET /api/rankings/me/best — 본인 최고기록 1건 (로그인 유저 + 게스트 둘 다, 인증 불필요)
const getMyBestRanking = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new AppError(422, "VALIDATION_ERROR", errors.array()[0].msg));
  }

  const identity = resolveIdentity(req);

  if (identity === null) {
    return res.status(200).json({ success: true, data: null });
  }

  const mode = req.query.mode as string;
  const period = req.query.period as string;
  const eventId =
    req.query.eventId !== undefined
      ? parseInt(req.query.eventId as string)
      : undefined;

  const data = await rankingsService.getMyBestRanking({
    identity,
    mode,
    period,
    eventId,
  });

  res.status(200).json({ success: true, data });
};

export { getRankings, getMyRankings, getMyBestRanking };
