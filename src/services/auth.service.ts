import bcrypt from "bcrypt";
import pool from "../config/db";
import jwt from "jsonwebtoken";
import config from "../config";
import { AppError } from "../middlewares/errorHandler";

const register = async (email: string, password: string, name: string) => {
  // 이메일 중복 확인
  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [
    email,
  ]);
  if (existing.rows.length > 0) {
    throw new AppError(409, "EMAIL_EXISTS", "이미 사용중인 이메일입니다.");
  }

  // 비밀번호 해싱
  const hashedPassword = await bcrypt.hash(password, 10);

  // DB 저장
  const result = await pool.query(
    "INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name, created_at",
    [email, hashedPassword, name],
  );
  return result.rows[0];
};

const login = async (email: string, password: string) => {
  // 이메일 확인
  const result = await pool.query(
    "SELECT id, email, name, password FROM users WHERE email = $1",
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

  // 비밀번호 확인
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "이메일 또는 비밀번호가 잘못되었습니다.",
    );
  }

  // 3. JWT 토큰 생성
  const accessToken = jwt.sign(
    { id: user.id, email: user.email },
    config.jwt.secret,
    { expiresIn: "1h" },
  );

  // 4. RefreshToken 발급
  const refreshToken = jwt.sign({ id: user.id }, config.jwt.secret, {
    expiresIn: "7d",
  });

  // 5. RefreshToken DB에 저장
  await pool.query("UPDATE users SET refresh_token = $1 WHERE id = $2", [
    refreshToken,
    user.id,
  ]);

  const userInfo = {
    id: user.id,
    email: user.email,
    name: user.name,
  };
  return {
    accessToken,
    refreshToken,
    userInfo,
  };
};

const refresh = async (refreshToken: string) => {
  // refreshToken 검증
  let decoded: { id: number }
  try {
    decoded = jwt.verify(refreshToken, config.jwt.secret) as { id: number }
  } catch {
    throw new AppError(401, "AUTH_INVALID_TOKEN", "유효하지 않은 토큰입니다.")
  }

  // DB에서 유저 조회 + DB의 refreshToken과 비교
  const result = await pool.query(
    'SELECT id, email FROM users WHERE id = $1 AND refresh_token = $2',
    [decoded.id, refreshToken]
  )
  const user = result.rows[0]
  if (!user) throw new AppError(401, "AUTH_INVALID_TOKEN", "유효하지 않은 토큰입니다.")

  // 새 accessToken 발급
  const accessToken = jwt.sign(
    { id: user.id, email: user.email },
    config.jwt.secret,
    { expiresIn: '1h' }
  )

  return { accessToken }
}

const logout = async (userId: number) => {
  // Db에서 refreshtoken 삭제
  await pool.query("UPDATE users SET refresh_token = NULL WHERE id = $1", [
    userId,
  ]);
  return { userId };
};

export { register, login, logout, refresh };
