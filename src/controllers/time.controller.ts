import { Request, Response } from "express";

// GET /api/time — 서버 시각 (프론트 clock drift 보정용)
// ms 단위 정확도는 카운트다운 UI 에 불필요하고, 봇이 회차 open 순간을 밀리초 단위로
// 겨냥해 정직한 유저보다 항상 먼저 좌석을 잡는 데 악용될 수 있으므로 초 단위로 반올림.
const getTime = (_req: Request, res: Response) => {
  const nowSec = new Date(Math.floor(Date.now() / 1000) * 1000);
  res.status(200).json({
    success: true,
    data: { now: nowSec.toISOString() },
  });
};

export { getTime };
