import dotenv from "dotenv";
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`환경변수 ${key}가 설정되지 않았습니다.`);
  }
  return value;
}

const jwtSecret = requireEnv("JWT_SECRET");
if (jwtSecret.length < 32) {
  throw new Error("JWT_SECRET은 최소 32자 이상이어야 합니다.");
}

const nodeEnv = process.env.NODE_ENV || "development";

const rawCorsOrigins = process.env.CORS_ORIGINS;
if (nodeEnv === "production" && !rawCorsOrigins) {
  throw new Error("프로덕션 환경에서는 CORS_ORIGINS가 필수입니다.");
}
const corsOrigins = (rawCorsOrigins || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const activeCapacity = parseInt(process.env.LIVE_ACTIVE_CAPACITY || "20", 10);
if (!Number.isInteger(activeCapacity) || activeCapacity < 1 || activeCapacity > 1000) {
  throw new Error("LIVE_ACTIVE_CAPACITY는 1~1000 범위의 정수여야 합니다.");
}

const holdTtlSeconds = parseInt(process.env.LIVE_HOLD_TTL_SECONDS || "30", 10);
if (!Number.isInteger(holdTtlSeconds) || holdTtlSeconds < 10 || holdTtlSeconds > 300) {
  throw new Error("LIVE_HOLD_TTL_SECONDS는 10~300 범위의 정수여야 합니다.");
}

const ticketRankCutoff = parseInt(process.env.LIVE_TICKET_RANK_CUTOFF || "10", 10);
if (!Number.isInteger(ticketRankCutoff) || ticketRankCutoff < 1 || ticketRankCutoff > 100) {
  throw new Error("LIVE_TICKET_RANK_CUTOFF는 1~100 범위의 정수여야 합니다.");
}

const config = {
  port: process.env.PORT || 3001,
  nodeEnv,
  corsOrigins,
  db: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    name: process.env.DB_NAME || "ticketingweb",
    user: process.env.DB_USERNAME || "postgres",
    password: requireEnv("DB_PASSWORD"),
  },
  jwt: {
    secret: jwtSecret,
  },
  live: {
    activeCapacity,
    holdTtlSeconds,
    ticketRankCutoff,
  },
};

export default config;
