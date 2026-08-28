declare namespace Express {
  interface Request {
    user?: {
      id: number;
      email: string;
    };
    /** accessToken 쿠키가 존재했지만 jwt.verify 실패한 경우 true. optionalAuth 만 세팅. */
    authExpired?: boolean;
  }
}
