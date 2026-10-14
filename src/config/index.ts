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

const activeCapacity = parseInt(process.env.LIVE_ACTIVE_CAPACITY || "100", 10);
if (
  !Number.isInteger(activeCapacity) ||
  activeCapacity < 1 ||
  activeCapacity > 1000
) {
  throw new Error("LIVE_ACTIVE_CAPACITY는 1~1000 범위의 정수여야 합니다.");
}

const holdTtlSeconds = parseInt(process.env.LIVE_HOLD_TTL_SECONDS || "30", 10);
if (
  !Number.isInteger(holdTtlSeconds) ||
  holdTtlSeconds < 10 ||
  holdTtlSeconds > 300
) {
  throw new Error("LIVE_HOLD_TTL_SECONDS는 10~300 범위의 정수여야 합니다.");
}

// queued/active 세션이 heartbeat(대기열 폴링·좌석맵 조회·hold·confirm) 없이 방치되면
// (탭 강제 종료, 네트워크 끊김 등) 이 시간 후 자동으로 failed 처리한다.
const sessionHeartbeatTtlSeconds = parseInt(
  process.env.LIVE_SESSION_HEARTBEAT_TTL_SECONDS || "30",
  10,
);
if (
  !Number.isInteger(sessionHeartbeatTtlSeconds) ||
  sessionHeartbeatTtlSeconds < 10 ||
  sessionHeartbeatTtlSeconds > 300
) {
  throw new Error(
    "LIVE_SESSION_HEARTBEAT_TTL_SECONDS는 10~300 범위의 정수여야 합니다.",
  );
}

// 스윕 테스트용: 값 바꿔가며 서버 재시작만으로 비교 가능하게 env로 노출.
const poolMax = parseInt(process.env.DB_POOL_MAX || "30", 10);
if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 200) {
  throw new Error("DB_POOL_MAX는 1~200 범위의 정수여야 합니다.");
}

const poolConnectionTimeoutMillis = parseInt(
  process.env.DB_POOL_CONNECTION_TIMEOUT_MS || "5000",
  10,
);

// 0 이면 무제한(현재 기본 동작: activeCapacity 여유만큼 한 tick에 다 승격).
const promoteBatchCap = parseInt(
  process.env.LIVE_PROMOTE_BATCH_CAP || "0",
  10,
);
if (!Number.isInteger(promoteBatchCap) || promoteBatchCap < 0) {
  throw new Error("LIVE_PROMOTE_BATCH_CAP는 0 이상의 정수여야 합니다.");
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
    poolMax,
    poolConnectionTimeoutMillis,
  },
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
  },
  jwt: {
    secret: jwtSecret,
  },
  live: {
    activeCapacity,
    holdTtlSeconds,
    sessionHeartbeatTtlSeconds,
    promoteBatchCap,
  },
};

export default config;
