import { Request, Response } from "express";
import * as statsService from "../services/stats.service";

const getDailyStats = async (_req: Request, res: Response) => {
  const data = await statsService.getDailyStats();

  // 서비스 계층에 5분 서버 캐시가 이미 있지만 그건 DB 만 보호한다(요청은 리미터를 통과).
  // 브라우저 캐시를 함께 걸어 새로고침 반복 시 요청 자체가 안 나가게 한다.
  res.setHeader("Cache-Control", "public, max-age=60");
  res.status(200).json({
    success: true,
    data,
  });
};

export { getDailyStats };
