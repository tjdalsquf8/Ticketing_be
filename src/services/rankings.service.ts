import pool from "../config/db";
import { AppError } from "../middlewares/errorHandler";

const intervalMap = {
  daily: "1 day",
  weekly: "7 days",
  monthly: "30 days",
} as const;

type Period = keyof typeof intervalMap;

/**
 * 리더보드 표시명 = 그 사람의 **최고기록을 낸 세션 row 의 nickname 스냅샷**.
 *
 * 현재 닉네임(users.name / guests.nickname)을 조회하는 방식은 쓰지 않는다.
 * 게스트는 같은 guest_uuid 를 유지한 채 닉네임을 자유롭게 바꿀 수 있어서,
 * 현재값을 읽으면 이미 끝난 회차의 순위 행까지 소급해서 새 이름으로 바뀐다.
 *
 * 스냅샷 방식이면 새 이름을 랭킹에 올리려면 실제로 자기 최고기록을 깨야 하므로
 * 소급 조작이 불가능하다. 게스트끼리 같은 닉네임을 쓰는 것 자체는 허용되며
 * (참여 시점 중복 차단 없음), 행은 닉네임이 아니라 guest_uuid 로 dedup 된다.
 * 로그인 유저도 같은 규칙을 적용해 쿼리를 단순하게 둔다
 * (회원 여부는 is_verified 뱃지로 구분된다).
 *
 * tie-break: elapsed_ms 동률이면 먼저 시작한 세션(started_at ASC)의 닉네임.
 * 정렬 키를 둘 다 고정해야 같은 입력에 대해 항상 같은 표시명이 나온다.
 */
const BEST_RECORD_NICKNAME =
  "(array_agg(nickname ORDER BY elapsed_ms ASC, started_at ASC))[1]";

const getRankings = async (params: {
  mode: string;
  period?: string;
  page: number;
  size: number;
  eventId?: number;
}) => {
  const { mode, page, size, period, eventId } = params;

  if (!period || !(period in intervalMap)) {
    throw new AppError(
      400,
      "INVALID_PERIOD",
      "period는 daily, weekly, monthly 중 하나여야 합니다.",
    );
  }
  const interval = intervalMap[period as Period];
  const clampedSize = Math.min(size, 100);
  const clampedPage = Math.min(page, Math.ceil(100 / clampedSize));
  const offset = (clampedPage - 1) * clampedSize;

  if (mode === "live") {
    const mainParams: (string | number)[] = [clampedSize, offset];
    let eventFilter: string;
    if (eventId !== undefined) {
      mainParams.push(eventId);
      eventFilter = `AND event_id = $${mainParams.length}`;
    } else {
      eventFilter = "";
    }

    const result = await pool.query(
      `SELECT
         -- ::int 캐스트 필수. RANK 는 bigint 라 캐스트 없으면 JSON 에 문자열로 나가서
         -- /rankings/me/best 의 rank(number)와 타입이 어긋난다.
         (RANK() OVER (ORDER BY MIN(elapsed_ms)))::int AS rank,
         ${BEST_RECORD_NICKNAME} AS nickname,
         MIN(elapsed_ms) AS best_ms,
         (user_id IS NOT NULL) AS is_verified
       FROM live_sessions
       WHERE status = 'completed'
         AND started_at >= NOW() - INTERVAL '${interval}'
         ${eventFilter}
       GROUP BY COALESCE(user_id::text, guest_uuid), user_id
       ORDER BY best_ms
       LIMIT $1 OFFSET $2`,
      mainParams,
    );

    const countParams: (string | number)[] = [];
    let countEventFilter: string;
    if (eventId !== undefined) {
      countParams.push(eventId);
      countEventFilter = `AND event_id = $${countParams.length}`;
    } else {
      countEventFilter = "";
    }

    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT COALESCE(user_id::text, guest_uuid)) AS total
       FROM live_sessions
       WHERE status = 'completed'
         AND started_at >= NOW() - INTERVAL '${interval}'
         ${countEventFilter}`,
      countParams,
    );

    return {
      data: result.rows,
      total: parseInt(countResult.rows[0].total),
    };
  }

  const mainParams: (string | number)[] = [mode, clampedSize, offset];
  let eventFilter: string;
  if (eventId !== undefined) {
    mainParams.push(eventId);
    eventFilter = `AND event_id = $${mainParams.length}`;
  } else {
    eventFilter = "";
  }

  const result = await pool.query(
    `SELECT
       -- ::int 캐스트 필수 (live 분기와 같은 이유).
       (RANK() OVER (ORDER BY MIN(elapsed_ms)))::int AS rank,
       ${BEST_RECORD_NICKNAME} AS nickname,
       MIN(elapsed_ms) AS best_ms,
       (user_id IS NOT NULL) AS is_verified
     FROM practice_sessions
     WHERE completed_at IS NOT NULL
       AND mode = $1
       AND started_at >= NOW() - INTERVAL '${interval}'
       AND ranking_eligible = true
       ${eventFilter}
     GROUP BY COALESCE(user_id::text, guest_uuid), user_id
     ORDER BY best_ms
     LIMIT $2 OFFSET $3`,
    mainParams,
  );

  const countParams: (string | number)[] = [mode];
  let countEventFilter: string;
  if (eventId !== undefined) {
    countParams.push(eventId);
    countEventFilter = `AND event_id = $${countParams.length}`;
  } else {
    countEventFilter = "";
  }

  const countResult = await pool.query(
    `SELECT COUNT(DISTINCT COALESCE(user_id::text, guest_uuid)) AS total
     FROM practice_sessions
     WHERE completed_at IS NOT NULL
       AND mode = $1
       AND started_at >= NOW() - INTERVAL '${interval}'
       AND ranking_eligible = true
       ${countEventFilter}`,
    countParams,
  );

  return {
    data: result.rows,
    total: parseInt(countResult.rows[0].total),
  };
};

// ─── 내 기록 ─────────────────────────────────────────────────────────────────

/**
 * 요청자 본인이 낸 기록 전체를 최신순으로 반환한다.
 *
 * getRankings 와 달리 identity 별 집계가 아니라 **시도 한 건이 한 행**이다.
 * 랭킹 상위권에 못 들어간 기록도 전부 나온다.
 *
 * 식별은 `COALESCE(user_id::text, guest_uuid)` 로 통일한다 (게스트도 조회 가능).
 * 닉네임이 아니라 identity 로 묶으므로, 게스트가 닉네임을 바꿔도 이전 닉네임으로
 * 낸 시도까지 전부 한 목록에 남는다.
 *
 * `nickname` 은 응답에 넣지 않는다 — 본인 화면이라 이름을 보여줄 이유가 없고,
 * 회원·게스트 모두 동일하다. 표시명이 필요한 곳은 리더보드(getRankings)와
 * 최고기록(getMyBestRanking) 뿐이다.
 *
 * `rank` 는 "이 기록이 전체 랭킹에서 몇 위인가" — 나를 제외한 다른 참가자들의
 * 개인 최고기록(MIN(elapsed_ms)) 중 내 기록보다 빠른 것의 수 + 1 이다.
 * 리더보드의 등수 계산과 같은 모집단을 쓰므로 두 화면의 숫자가 일치한다.
 *
 * `best_ms` / `is_verified` 는 기존 랭킹 응답과 shape 을 맞추기 위한 호환 필드다.
 * best_ms 는 그 시도의 elapsed_ms 와 같은 값이다.
 */
const getMyRankings = async (params: {
  identity: string;
  mode: string;
  period?: string;
  page: number;
  size: number;
  eventId?: number;
}) => {
  const { identity, mode, period, page, size, eventId } = params;

  if (!period || !(period in intervalMap)) {
    throw new AppError(
      400,
      "INVALID_PERIOD",
      "period는 daily, weekly, monthly 중 하나여야 합니다.",
    );
  }
  // intervalMap 의 값만 보간되므로 사용자 입력이 SQL 에 직접 들어가지 않는다.
  const interval = intervalMap[period as Period];

  // 리더보드가 아니라 개인 이력이므로 getRankings 의 "총 100행" 상한은 적용하지 않는다.
  const clampedSize = Math.min(Math.max(size, 1), 100);
  const offset = (Math.max(page, 1) - 1) * clampedSize;

  // 아래 SQL 조각들은 전부 mode 분기로 고른 리터럴이다. 사용자 입력은 $n 바인딩으로만 들어간다.
  const isLive = mode === "live";
  const table = isLive ? "public.live_sessions" : "public.practice_sessions";
  // live_sessions 는 status 컬럼으로, practice_sessions 는 completed_at 으로 완주를 판단한다.
  // 테이블 별칭이 붙는 자리와 안 붙는 자리를 따로 만들어 둔다.
  const completedFilter = (alias: string) =>
    isLive
      ? `${alias}status = 'completed'`
      : `${alias}completed_at IS NOT NULL AND ${alias}mode = 'practice' AND ${alias}ranking_eligible = true`;
  const periodFilter = (alias: string) =>
    `${alias}started_at >= NOW() - INTERVAL '${interval}'`;

  const values: (string | number)[] = [identity];
  let eventFilter = (_alias: string) => "";
  if (eventId !== undefined) {
    values.push(eventId);
    const idx = values.length;
    eventFilter = (alias: string) => `AND ${alias}event_id = $${idx}`;
  }

  const dataResult = await pool.query(
    `WITH peers AS (
       SELECT MIN(elapsed_ms) AS best_ms
       FROM ${table}
       WHERE ${completedFilter("")}
         AND ${periodFilter("")}
         AND COALESCE(user_id::text, guest_uuid) IS DISTINCT FROM $1
         ${eventFilter("")}
       GROUP BY COALESCE(user_id::text, guest_uuid)
     )
     SELECT
       -- ::int 캐스트 필수. COUNT 는 bigint 라 캐스트 없으면 JSON 에 문자열로 나간다.
       ((SELECT COUNT(*) FROM peers p WHERE p.best_ms < s.elapsed_ms) + 1)::int AS rank,
       s.elapsed_ms AS best_ms,
       s.elapsed_ms,
       (s.user_id IS NOT NULL) AS is_verified,
       s.started_at,
       s.event_id,
       s.session_id
     FROM ${table} s
     WHERE COALESCE(s.user_id::text, s.guest_uuid) = $1
       AND ${completedFilter("s.")}
       AND ${periodFilter("s.")}
       ${eventFilter("s.")}
     ORDER BY s.started_at DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, clampedSize, offset],
  );

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM ${table}
     WHERE COALESCE(user_id::text, guest_uuid) = $1
       AND ${completedFilter("")}
       AND ${periodFilter("")}
       ${eventFilter("")}`,
    values,
  );

  return {
    data: dataResult.rows,
    total: countResult.rows[0].total,
  };
};

// ─── 내 최고기록 (게스트 포함) ─────────────────────────────────────────────────

type MyBestRanking = {
  rank: number;
  nickname: string;
  best_ms: number;
  is_verified: boolean;
};

/**
 * 요청자(로그인 유저 또는 게스트) 개인 최고기록 1건 + 전체 순위.
 *
 * getMyRankings 와 달리 user_id 로만 식별하지 않는다 — 게스트도 guest_uuid 로
 * 조회 가능해야 하므로 identity 를 `COALESCE(user_id::text, guest_uuid)` 매칭
 * 하나로 통일한다. 인증 불필요.
 */
const getMyBestRanking = async (params: {
  identity: string;
  mode: string;
  period?: string;
  eventId?: number;
}): Promise<MyBestRanking | null> => {
  const { identity, mode, period, eventId } = params;

  if (!period || !(period in intervalMap)) {
    throw new AppError(
      400,
      "INVALID_PERIOD",
      "period는 daily, weekly, monthly 중 하나여야 합니다.",
    );
  }
  const interval = intervalMap[period as Period];

  const isLive = mode === "live";
  const table = isLive ? "public.live_sessions" : "public.practice_sessions";
  const completedFilter = (alias: string) =>
    isLive
      ? `${alias}status = 'completed'`
      : `${alias}completed_at IS NOT NULL AND ${alias}mode = 'practice' AND ${alias}ranking_eligible = true`;
  const periodFilter = (alias: string) =>
    `${alias}started_at >= NOW() - INTERVAL '${interval}'`;

  const values: (string | number)[] = [identity];
  let eventFilter = (_alias: string) => "";
  if (eventId !== undefined) {
    values.push(eventId);
    const idx = values.length;
    eventFilter = (alias: string) => `AND ${alias}event_id = $${idx}`;
  }

  const result = await pool.query(
    `WITH peers AS (
       SELECT MIN(elapsed_ms) AS best_ms
       FROM ${table}
       WHERE ${completedFilter("")}
         AND ${periodFilter("")}
         AND COALESCE(user_id::text, guest_uuid) IS DISTINCT FROM $1
         ${eventFilter("")}
       GROUP BY COALESCE(user_id::text, guest_uuid)
     ),
     mine AS (
       -- 리더보드(BEST_RECORD_NICKNAME)와 같은 정렬 키로 최고기록 row 를 고른다.
       -- 표시명도 그 row 의 nickname 스냅샷이라 두 화면의 이름이 항상 일치한다.
       SELECT s.user_id, s.elapsed_ms, s.nickname
       FROM ${table} s
       WHERE COALESCE(s.user_id::text, s.guest_uuid) = $1
         AND ${completedFilter("s.")}
         AND ${periodFilter("s.")}
         ${eventFilter("s.")}
       ORDER BY s.elapsed_ms ASC, s.started_at ASC
       LIMIT 1
     )
     SELECT
       ((SELECT COUNT(*) FROM peers p WHERE p.best_ms < mine.elapsed_ms) + 1)::int AS rank,
       mine.nickname,
       mine.elapsed_ms AS best_ms,
       (mine.user_id IS NOT NULL) AS is_verified
     FROM mine`,
    values,
  );

  return result.rows[0] ?? null;
};

export { getRankings, getMyRankings, getMyBestRanking };
