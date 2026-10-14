import { redis } from "../config/redis";

/**
 * 대기열/활성(좌석 선택) 단계의 세션 레코드를 Redis Hash로 관리한다.
 *
 * key 설계:
 *   session:{sessionId}                         → Hash (세션 레코드 본체)
 *   dedup:round:{roundId}:user:{userId}         → String (sessionId 포인터)
 *   dedup:round:{roundId}:guest:{guestUuid}     → String (sessionId 포인터)
 *   heartbeat:sessions                          → ZSET (member=sessionId, score=마지막 활동 epoch ms)
 *
 * heartbeat ZSET은 "방치된 세션 찾기"용 색인이다. Hash를 전부 스캔할 수 없으니
 * (Redis에 "WHERE lastSeenAt < X" 같은 조건 조회가 없음) 별도로 시간순 정렬된
 * 색인을 하나 더 들고 있다가, sweepStaleSessions가 ZRANGEBYSCORE로 오래된 것만 뽑는다.
 *
 * Postgres에는 confirm(구매 확정) 성공 시점에만 쓴다 — 그 전까지는 이 Hash가
 * "진행 중인 세션"의 유일한 저장소다. 서버가 죽으면 진행 중 세션은 다시
 * 참여해야 한다 (대기열 참여는 멱등하게 재시도 가능하므로 치명적이지 않음).
 */

export type LiveSessionStatus = "queued" | "active";

export interface LiveSessionRecord {
  sessionId: string;
  roundId: number;
  userId: number | null;
  guestUuid: string | null;
  nickname: string;
  status: LiveSessionStatus;
  startedAt: string; // ISO
  seatLabel: string | null;
  lastSeenAt: string; // ISO — heartbeat, sweepStaleSessions가 이 값을 기준으로 방치 세션을 정리한다
}

function sessionKey(sessionId: string): string {
  return `session:${sessionId}`;
}

function dedupKey(roundId: number, userId: number | null, guestUuid: string | null): string {
  return userId != null
    ? `dedup:round:${roundId}:user:${userId}`
    : `dedup:round:${roundId}:guest:${guestUuid}`;
}

const HEARTBEAT_KEY = "heartbeat:sessions";

/**
 * 세션 레코드를 새로 만든다. 동시에 dedup 포인터도 심어둔다.
 * 호출 전에 중복 여부 확인은 호출부 책임 (findExistingSessionId 참고).
 */
async function createSessionRecord(params: {
  sessionId: string;
  roundId: number;
  userId: number | null;
  guestUuid: string | null;
  nickname: string;
  status: LiveSessionStatus;
}): Promise<LiveSessionRecord> {
  const { sessionId, roundId, userId, guestUuid, nickname, status } = params;
  const startedAt = new Date().toISOString();

  await redis.hset(sessionKey(sessionId), {
    sessionId,
    roundId: String(roundId),
    userId: userId != null ? String(userId) : "",
    guestUuid: guestUuid ?? "",
    nickname,
    status,
    startedAt,
    seatLabel: "",
    lastSeenAt: startedAt,
  });
  await redis.set(dedupKey(roundId, userId, guestUuid), sessionId);
  await redis.zadd(HEARTBEAT_KEY, Date.now(), sessionId);

  return {
    sessionId,
    roundId,
    userId,
    guestUuid,
    nickname,
    status,
    startedAt,
    seatLabel: null,
    lastSeenAt: startedAt,
  };
}

/** 세션 레코드를 조회한다. 없으면 null. */
async function getSessionRecord(sessionId: string): Promise<LiveSessionRecord | null> {
  const h = await redis.hgetall(sessionKey(sessionId));
  if (Object.keys(h).length === 0) return null;

  return {
    sessionId: h.sessionId,
    roundId: parseInt(h.roundId, 10),
    userId: h.userId ? parseInt(h.userId, 10) : null,
    guestUuid: h.guestUuid || null,
    nickname: h.nickname,
    status: h.status as LiveSessionStatus,
    startedAt: h.startedAt,
    seatLabel: h.seatLabel || null,
    lastSeenAt: h.lastSeenAt || h.startedAt,
  };
}

/** heartbeat: 폴링/SSE 재조회 시점마다 "살아있음" 신호로 lastSeenAt을 갱신한다. */
async function touchHeartbeat(sessionId: string): Promise<void> {
  const now = Date.now();
  await redis.hset(sessionKey(sessionId), { lastSeenAt: new Date(now).toISOString() });
  await redis.zadd(HEARTBEAT_KEY, now, sessionId);
}

/** heartbeat가 cutoffMs(epoch ms) 이전으로 오래된 sessionId 목록을 찾는다. */
async function findStaleSessionIds(cutoffMs: number): Promise<string[]> {
  return redis.zrangebyscore(HEARTBEAT_KEY, 0, cutoffMs);
}

/** heartbeat 색인에서만 제거한다 (레코드가 이미 사라진 고아 항목 정리용). */
async function removeFromHeartbeat(sessionId: string): Promise<void> {
  await redis.zrem(HEARTBEAT_KEY, sessionId);
}

/** 같은 회차에 이미 진행 중인(queued/active) 세션이 있으면 그 sessionId를 반환한다. */
async function findExistingSessionId(
  roundId: number,
  userId: number | null,
  guestUuid: string | null,
): Promise<string | null> {
  return redis.get(dedupKey(roundId, userId, guestUuid));
}

/** 세션 상태를 바꾼다 (queued → active 등). */
async function updateStatus(sessionId: string, status: LiveSessionStatus): Promise<void> {
  await redis.hset(sessionKey(sessionId), { status });
}

/**
 * 세션 레코드를 완전히 지운다 (이탈/승격 완료/구매 확정 후).
 * dedup 포인터도 같이 지워야 다음 참여 때 "이미 있다"고 오판하지 않는다.
 */
async function deleteSessionRecord(
  sessionId: string,
  roundId: number,
  userId: number | null,
  guestUuid: string | null,
): Promise<void> {
  await redis.del(sessionKey(sessionId), dedupKey(roundId, userId, guestUuid));
  await redis.zrem(HEARTBEAT_KEY, sessionId);
}

export {
  createSessionRecord,
  getSessionRecord,
  findExistingSessionId,
  updateStatus,
  touchHeartbeat,
  findStaleSessionIds,
  removeFromHeartbeat,
  deleteSessionRecord,
};
