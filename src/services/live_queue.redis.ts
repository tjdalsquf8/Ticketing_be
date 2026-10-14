import { redis } from "../config/redis";
import type { SeatContextType } from "../events/seatEvents";

/**
 * 대기열 ZSET 조작을 캡슐화한다.
 *
 * key 설계:
 *   queue:{contextType}:{contextId}      → ZSET (member=sessionId, score=입장 순번)
 *   queue:seq:{contextType}:{contextId}  → 순번 카운터 (INCR 전용)
 *
 * 순번(score)은 "들어온 순서 번호"다. 타임스탬프를 score로 쓰면 같은 ms에
 * 여러 명이 들어올 때 동률이 날 수 있어, INCR로 1씩 증가하는 정수를 쓴다.
 * INCR과 ZADD를 분리해서 두 번 호출하면 그 사이에 다른 요청이 끼어들어
 * 번호가 꼬일 수 있으므로, Lua 스크립트로 한 번에 원자적으로 처리한다.
 */

function zsetKey(contextType: SeatContextType, contextId: number): string {
  return `queue:${contextType}:${contextId}`;
}

function seqKey(contextType: SeatContextType, contextId: number): string {
  return `queue:seq:${contextType}:${contextId}`;
}

// KEYS[1] = seqKey, KEYS[2] = zsetKey, ARGV[1] = sessionId
const ENQUEUE_SCRIPT = `
local seq = redis.call("INCR", KEYS[1])
redis.call("ZADD", KEYS[2], seq, ARGV[1])
return seq
`;

/**
 * 대기열에 세션을 추가한다. 이미 들어가 있으면 ZADD가 score만 갱신하므로
 * 호출 전에 중복 여부를 먼저 확인해야 한다 (createSession 쪼 호출부 책임).
 */
async function enqueue(
  contextType: SeatContextType,
  contextId: number,
  sessionId: string,
): Promise<number> {
  const seq = await redis.eval(
    ENQUEUE_SCRIPT,
    2,
    seqKey(contextType, contextId),
    zsetKey(contextType, contextId),
    sessionId,
  );
  return seq as number;
}

/**
 * 내 순번을 조회한다 (1-base). 대기열에 없으면 null.
 * ZRANK는 0-base(나보다 score 작은 사람 수)라 +1 해서 "내 자리 번호"로 변환한다.
 */
async function rank(
  contextType: SeatContextType,
  contextId: number,
  sessionId: string,
): Promise<number | null> {
  const r = await redis.zrank(zsetKey(contextType, contextId), sessionId);
  return r == null ? null : r + 1;
}

/**
 * 대기열에서 세션을 제거한다 (승격 또는 이탈 시).
 */
async function dequeue(
  contextType: SeatContextType,
  contextId: number,
  sessionIds: string[],
): Promise<void> {
  if (sessionIds.length === 0) return;
  await redis.zrem(zsetKey(contextType, contextId), ...sessionIds);
}

/**
 * 순번이 가장 앞선 count명의 sessionId를 뽑는다 (승격 대상 선정용).
 */
async function peekFront(
  contextType: SeatContextType,
  contextId: number,
  count: number,
): Promise<string[]> {
  if (count <= 0) return [];
  return redis.zrange(zsetKey(contextType, contextId), 0, String(count - 1));
}

/** 대기열 전체 멤버 (회차 마감 정리용). */
async function allMembers(contextType: SeatContextType, contextId: number): Promise<string[]> {
  return redis.zrange(zsetKey(contextType, contextId), 0, "-1");
}

/** 회차 마감 시 대기열 키 전체를 지운다 (순번 카운터 포함). */
async function clearRound(contextType: SeatContextType, contextId: number): Promise<void> {
  await redis.del(zsetKey(contextType, contextId), seqKey(contextType, contextId));
}

export { enqueue, rank, dequeue, peekFront, allMembers, clearRound, zsetKey, seqKey };
