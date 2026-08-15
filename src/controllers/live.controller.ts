import { Request, Response } from "express";
import * as liveService from "../services/live.service";

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

// GET /api/live/recent-results?limit=N — 최근 종료 회차 요약 (각 회차별 top3)
const getRecentResults = async (req: Request, res: Response) => {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), 10)
    : 3;
  const data = await liveService.getRecentResults(limit);
  res.status(200).json({ success: true, data });
};

export { getCurrent, getNext, getRecentResults };
