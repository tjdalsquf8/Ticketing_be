import { redis } from "../config/redis";

/**
 * 활성(좌석 선택 중) 인원을 Redis Set으로 관리한다.
 * key: active:round:{roundId} → Set<sessionId>
 *
 * "정원 확인 + 등록"을 Lua로 묶어 원자적으로 처리한다 — 두 요청이 동시에
 * 들어와도 Redis가 스크립트 전체를 한 번에, 쪼개지지 않게 실행해주므로
 * 정원을 초과해서 들어가는 경우가 생기지 않는다.
 */

function activeKey(roundId: number): string {
  return `active:round:${roundId}`;
}

// KEYS[1] = activeKey, ARGV[1] = sessionId, ARGV[2] = capacity
const TRY_ENTER_SCRIPT = `
local count = redis.call("SCARD", KEYS[1])
if count < tonumber(ARGV[2]) then
  redis.call("SADD", KEYS[1], ARGV[1])
  return 1
else
  return 0
end
`;

/**
 * 정원 여유가 있으면 활성 집합에 추가하고 true, 꽉 차 있으면 false.
 * "SCARD로 확인 → SADD로 등록" 두 단계를 한 Lua 호출로 묶어서 중간에
 * 다른 요청이 끼어들 틈을 없앤다.
 */
async function tryEnterActive(
  roundId: number,
  sessionId: string,
  capacity: number,
): Promise<boolean> {
  const result = await redis.eval(
    TRY_ENTER_SCRIPT,
    1,
    activeKey(roundId),
    sessionId,
    String(capacity),
  );
  return result === 1;
}

/** 활성 집합에서 제거한다 (이탈/구매 확정 시). */
async function leaveActive(roundId: number, sessionId: string): Promise<void> {
  await redis.srem(activeKey(roundId), sessionId);
}

/** 현재 활성 인원 수. */
async function activeCount(roundId: number): Promise<number> {
  return redis.scard(activeKey(roundId));
}

/**
 * 대기열에서 승격된 sessionId들을 한 번에 활성 집합에 추가한다 (promoteQueuedSessions 전용).
 * 승격 대상 수(slots)는 호출부가 이미 activeCount 기준으로 계산해뒀으므로
 * 여기선 정원 재확인 없이 그냥 추가한다.
 */
async function addActive(roundId: number, sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  await redis.sadd(activeKey(roundId), ...sessionIds);
}

/** 활성 집합 전체 멤버 (회차 마감 정리용). */
async function members(roundId: number): Promise<string[]> {
  return redis.smembers(activeKey(roundId));
}

/** 회차 마감 시 활성 집합 키를 지운다. */
async function clearRound(roundId: number): Promise<void> {
  await redis.del(activeKey(roundId));
}

export { tryEnterActive, leaveActive, activeCount, addActive, members, clearRound };
