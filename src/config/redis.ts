import Redis from "ioredis";
import config from "./index";

/**
 * ioredis subscribe 모드 커넥션은 일반 명령(GET/SET/ZADD 등)을 못 쓴다.
 * 그래서 명령 실행용(redis)과 구독 전용(redisSub)을 분리해서 export한다.
 */
const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
});

const redisSub = new Redis({
  host: config.redis.host,
  port: config.redis.port,
});

// ioredis는 'error' 리스너가 없으면 소켓 에러 시 프로세스가 죽는다.
// 재연결은 ioredis가 기본 retryStrategy로 자동 처리하므로 여기선 로깅만 한다.
for (const [name, client] of [
  ["redis", redis],
  ["redisSub", redisSub],
] as const) {
  client.on("error", (err) => console.error(`[${name}] connection error:`, err.message));
  client.on("reconnecting", () => console.warn(`[${name}] reconnecting...`));
}

export { redis, redisSub };
