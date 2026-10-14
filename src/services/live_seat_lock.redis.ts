import { redis } from "../config/redis";

/**
 * 좌석 hold(임시 점유) 동시성을 Redis로 관리한다.
 *
 * key 설계:
 *   seat:round:{roundId}:{seatLabel}      → Hash {actorKey} — 존재하면 "held", TTL로 자동 만료
 *   myhold:round:{roundId}:{actorKey}     → String seatLabel — 역방향 조회(내가 뭘 잡고 있나), 같은 TTL
 *
 * "판매 완료(sold)"는 영구 기록이라 Redis에 안 둔다 — confirm 성공 시 Postgres
 * live_seats에 쓴다. Redis는 hold 키가 "존재하는 동안만 held"다. TTL이 지나면
 * Redis가 알아서 키를 지워버리므로, 별도 만료 스윕 크론이 필요 없다.
 *
 * shortcut: holdSeat에서 "이미 sold인가"는 Postgres 별도 조회로 확인하는데, 이
 * 조회와 Lua hold 시도 사이에 아주 짧은 틈이 있다 (다른 확정이 그 틈에 끼어들
 * 이론적 가능성). 실제로는 confirm 쪽이 hold 소유자만 통과시키므로 발생 확률이
 * 매우 낮고, 만약 발생해도 confirm 단계의 재검증에서 걸러진다. 완벽히 막으려면
 * Postgres까지 포함한 분산 트랜잭션이 필요한데, 그러면 Redis로 옮긴 의미가
 * 없어지므로 의도적으로 감수한다.
 */

function seatKey(roundId: number, seatLabel: string): string {
  return `seat:round:${roundId}:${seatLabel}`;
}

function myHoldKey(roundId: number, actorKey: string): string {
  return `myhold:round:${roundId}:${actorKey}`;
}

// ARGV[1]=roundId, ARGV[2]=seatLabel, ARGV[3]=actorKey, ARGV[4]=ttlMs
const TRY_HOLD_SCRIPT = `
local seatKey = "seat:round:" .. ARGV[1] .. ":" .. ARGV[2]
local myHoldKey = "myhold:round:" .. ARGV[1] .. ":" .. ARGV[3]

local holder = redis.call("HGET", seatKey, "actorKey")
if holder and holder ~= ARGV[3] then
  return "HELD"
end

local prevSeatLabel = redis.call("GET", myHoldKey)
if prevSeatLabel and prevSeatLabel ~= ARGV[2] then
  local prevSeatKey = "seat:round:" .. ARGV[1] .. ":" .. prevSeatLabel
  local prevHolder = redis.call("HGET", prevSeatKey, "actorKey")
  if prevHolder == ARGV[3] then
    redis.call("DEL", prevSeatKey)
  end
end

redis.call("HSET", seatKey, "actorKey", ARGV[3])
redis.call("PEXPIRE", seatKey, tonumber(ARGV[4]))
redis.call("SET", myHoldKey, ARGV[2], "PX", ARGV[4])
return "OK"
`;

// ARGV[1]=roundId, ARGV[2]=seatLabel, ARGV[3]=actorKey
const CONFIRM_HOLD_SCRIPT = `
local seatKey = "seat:round:" .. ARGV[1] .. ":" .. ARGV[2]
local myHoldKey = "myhold:round:" .. ARGV[1] .. ":" .. ARGV[3]

local holder = redis.call("HGET", seatKey, "actorKey")
if not holder or holder ~= ARGV[3] then
  return "EXPIRED"
end

redis.call("DEL", seatKey)
redis.call("DEL", myHoldKey)
return "OK"
`;

// ARGV[1]=roundId, ARGV[2]=actorKey — 내가 들고 있는 hold를 통째로 해제 (이탈 시)
const RELEASE_MY_HOLD_SCRIPT = `
local myHoldKey = "myhold:round:" .. ARGV[1] .. ":" .. ARGV[2]
local seatLabel = redis.call("GET", myHoldKey)
if not seatLabel then
  return false
end

local seatKey = "seat:round:" .. ARGV[1] .. ":" .. seatLabel
local holder = redis.call("HGET", seatKey, "actorKey")
if holder == ARGV[2] then
  redis.call("DEL", seatKey)
end
redis.call("DEL", myHoldKey)
return seatLabel
`;

/** 좌석 hold를 시도한다. "OK" 성공, "HELD" 다른 사람이 점유 중. */
async function tryHold(
  roundId: number,
  seatLabel: string,
  actorKey: string,
  ttlMs: number,
): Promise<"OK" | "HELD"> {
  const result = await redis.eval(
    TRY_HOLD_SCRIPT,
    0,
    String(roundId),
    seatLabel,
    actorKey,
    String(ttlMs),
  );
  return result as "OK" | "HELD";
}

/** hold를 구매 확정으로 전환(해제)한다. "OK" 성공, "EXPIRED" 만료/소유자 불일치. */
async function confirmHold(
  roundId: number,
  seatLabel: string,
  actorKey: string,
): Promise<"OK" | "EXPIRED"> {
  const result = await redis.eval(CONFIRM_HOLD_SCRIPT, 0, String(roundId), seatLabel, actorKey);
  return result as "OK" | "EXPIRED";
}

/** 내가 들고 있는 hold를 해제한다 (이탈 시). 해제된 seatLabel, 없었으면 null. */
async function releaseMyHold(roundId: number, actorKey: string): Promise<string | null> {
  const result = await redis.eval(RELEASE_MY_HOLD_SCRIPT, 0, String(roundId), actorKey);
  return (result as string | false) || null;
}

/** 내가 지금 hold 중인 좌석과 남은 만료 시각을 조회한다. */
async function getMyHold(
  roundId: number,
  actorKey: string,
): Promise<{ seatLabel: string; expiresAt: string } | null> {
  const key = myHoldKey(roundId, actorKey);
  const seatLabel = await redis.get(key);
  if (seatLabel == null) return null;
  const ttlMs = await redis.pttl(key);
  if (ttlMs < 0) return null; // 조회 사이 만료됨
  return { seatLabel, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
}

/**
 * 지금 hold 중인 좌석 label 집합을 스캔한다 (좌석맵 렌더링용).
 * 회차당 held 수는 활성 정원 수준(수백 이하)이라 SCAN으로도 충분히 가볍다.
 */
async function scanHeldLabels(roundId: number): Promise<Set<string>> {
  const prefix = `seat:round:${roundId}:`;
  const held = new Set<string>();
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
    cursor = next;
    for (const key of keys) {
      held.add(key.slice(prefix.length));
    }
  } while (cursor !== "0");
  return held;
}

export { tryHold, confirmHold, releaseMyHold, getMyHold, scanHeldLabels, seatKey, myHoldKey };
