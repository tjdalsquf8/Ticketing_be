import bcrypt from "bcrypt";
import crypto from "crypto";
import pool from "../config/db";
import jwt from "jsonwebtoken";
import config from "../config";
import { AppError } from "../middlewares/errorHandler";

// refresh 토큰은 DB에 sha256 해시로만 저장. 원문은 HttpOnly 쿠키에만 존재.
// - bcrypt 대신 sha256을 쓰는 이유: refresh 검증이 요청 경로에 있어 지연에 민감하고,
//   토큰 자체가 128비트 이상 엔트로피(JWT 서명)를 이미 보장해 salted-KDF 이점이 없다.
const hashRefreshToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

const register = async (email: string, password: string, name: string) => {
  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [
    email,
  ]);
  if (existing.rows.length > 0) {
    throw new AppError(409, "EMAIL_EXISTS", "이미 사용중인 이메일입니다.");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const result = await pool.query(
    "INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at",
    [email, hashedPassword, name],
  );
  return result.rows[0];
};

const issueTokens = (user: { id: number; email: string }) => {
  const accessToken = jwt.sign(
    { id: user.id, email: user.email },
    config.jwt.secret,
    { expiresIn: "1h" },
  );
  // jti(랜덤 16바이트)로 매 발급마다 payload를 유니크하게 만든다.
  // JWT의 iat는 초 단위라 rotation이 1초 안에 두 번 일어나면 동일 토큰이 되어
  // hash 로테이션이 감지 못하는 문제가 발생한다. jti가 이 충돌을 막는다.
  const refreshToken = jwt.sign(
    { id: user.id, jti: crypto.randomBytes(16).toString("hex") },
    config.jwt.secret,
    { expiresIn: "7d" },
  );
  return { accessToken, refreshToken };
};

const login = async (email: string, password: string) => {
  const result = await pool.query(
    "SELECT id, email, name, password, role FROM users WHERE email = $1",
    [email],
  );
  const user = result.rows[0];
  if (!user) {
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "이메일 또는 비밀번호가 잘못되었습니다.",
    );
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "이메일 또는 비밀번호가 잘못되었습니다.",
    );
  }

  const { accessToken, refreshToken } = issueTokens({
    id: user.id,
    email: user.email,
  });

  await pool.query(
    "UPDATE users SET refresh_token_hash = $1 WHERE id = $2",
    [hashRefreshToken(refreshToken), user.id],
  );

  const userInfo = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as "user" | "admin",
  };
  return {
    accessToken,
    refreshToken,
    userInfo,
  };
};

// refresh 로테이션: 호출 시 access·refresh 모두 새 값 발급 + DB hash 교체.
// 이전 refresh 는 즉시 무효. 탈취된 refresh 가 먼저 사용되면 진짜 사용자는 다음 호출에서
// hash mismatch 로 401 → 로그인 화면으로 튕겨 이상 징후를 인지하게 됨 (수동 감지).
const refresh = async (refreshToken: string) => {
  let decoded: { id: number };
  try {
    decoded = jwt.verify(refreshToken, config.jwt.secret) as { id: number };
  } catch {
    throw new AppError(401, "AUTH_INVALID_TOKEN", "유효하지 않은 토큰입니다.");
  }

  const result = await pool.query(
    "SELECT id, email FROM users WHERE id = $1 AND refresh_token_hash = $2",
    [decoded.id, hashRefreshToken(refreshToken)],
  );
  const user = result.rows[0];
  if (!user) {
    // JWT 서명은 유효했으나 DB hash 와 매칭 실패 = 이미 소비된(rotate 된) refresh.
    // 재로그인·다른 기기 로그인·탈취 재사용 셋 중 하나이므로 관측을 위해 경고 로그.
    console.warn(
      `[auth] refresh token reuse or superseded (userId=${decoded.id})`,
    );
    throw new AppError(401, "AUTH_INVALID_TOKEN", "유효하지 않은 토큰입니다.");
  }

  const tokens = issueTokens({ id: user.id, email: user.email });

  await pool.query(
    "UPDATE users SET refresh_token_hash = $1 WHERE id = $2",
    [hashRefreshToken(tokens.refreshToken), user.id],
  );

  return tokens;
};

const logout = async (userId: number) => {
  await pool.query(
    "UPDATE users SET refresh_token_hash = NULL WHERE id = $1",
    [userId],
  );
  return { userId };
};

export { register, login, logout, refresh };
