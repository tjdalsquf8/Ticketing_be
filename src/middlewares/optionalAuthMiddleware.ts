import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import config from "../config";

const optionalAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const cookieToken = req.cookies?.accessToken as string | undefined;
  const headerToken = req.headers.authorization?.split(" ")[1];
  const token = cookieToken ?? headerToken;

  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as { id: number; email: string };
      req.user = decoded;
    } catch {
      // 토큰이 유효하지 않아도 통과하되, 만료 사실은 흔적을 남긴다.
      // 로그인 유저 요청이 조용히 게스트로 처리돼 세션·티켓 데이터가 오염되던 버그의 방어층.
      // 프론트는 응답 헤더로 refresh 를 트리거하고, 세션 생성 컨트롤러는 401 로 거절 판단.
      req.authExpired = true;
      res.setHeader("X-Auth-Expired", "1");
    }
  }

  next();
};

export default optionalAuthMiddleware;
