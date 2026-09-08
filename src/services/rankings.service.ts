import pool from "../config/db";
import { AppError } from "../middlewares/errorHandler";

const intervalMap = {
  daily: "1 day",
  weekly: "7 days",
  monthly: "30 days",
} as const;

type Period = keyof typeof intervalMap;

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
         RANK() OVER (ORDER BY MIN(elapsed_ms)) AS rank,
         nickname,
         MIN(elapsed_ms) AS best_ms,
         (user_id IS NOT NULL) AS is_verified
       FROM live_sessions
       WHERE status = 'completed'
         AND started_at >= NOW() - INTERVAL '${interval}'
         ${eventFilter}
       GROUP BY COALESCE(user_id::text, guest_uuid), nickname, user_id
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
       RANK() OVER (ORDER BY MIN(elapsed_ms)) AS rank,
       nickname,
       MIN(elapsed_ms) AS best_ms,
       (user_id IS NOT NULL) AS is_verified
     FROM practice_sessions
     WHERE completed_at IS NOT NULL
       AND mode = $1
       AND started_at >= NOW() - INTERVAL '${interval}'
       AND ranking_eligible = true
       ${eventFilter}
     GROUP BY COALESCE(user_id::text, guest_uuid), nickname, user_id
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
 * 로그인 유저 본인이 낸 기록 전체를 최신순으로 반환한다.
 *
 * getRankings 와 달리 identity 별 집계가 아니라 **시도 한 건이 한 행**이다.
 * 랭킹 상위권에 못 들어간 기록도 전부 나온다.
 *
 * `rank` 는 "이 기록이 전체 랭킹에서 몇 위인가" — 나를 제외한 다른 참가자들의
 * 개인 최고기록(MIN(elapsed_ms)) 중 내 기록보다 빠른 것의 수 + 1 이다.
 * 리더보드의 등수 계산과 같은 모집단을 쓰므로 두 화면의 숫자가 일치한다.
 *
 * `best_ms` / `nickname` / `is_verified` 는 기존 랭킹 응답과 shape 을 맞추기
 * 위한 호환 필드다. best_ms 는 그 시도의 elapsed_ms 와 같은 값이다.
 */
const getMyRankings = async (params: {
  userId: number;
  mode: string;
  period?: string;
  page: number;
  size: number;
  eventId?: number;
}) => {
  const { userId, mode, period, page, size, eventId } = params;

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

  const values: (string | number)[] = [userId];
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
         AND user_id IS DISTINCT FROM $1
         ${eventFilter("")}
       GROUP BY COALESCE(user_id::text, guest_uuid)
     )
     SELECT
       -- ::int 캐스트 필수. COUNT 는 bigint 라 캐스트 없으면 JSON 에 문자열로 나간다.
       ((SELECT COUNT(*) FROM peers p WHERE p.best_ms < s.elapsed_ms) + 1)::int AS rank,
       s.nickname,
       s.elapsed_ms AS best_ms,
       s.elapsed_ms,
       (s.user_id IS NOT NULL) AS is_verified,
       s.started_at,
       s.event_id,
       s.session_id
     FROM ${table} s
     WHERE s.user_id = $1
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
     WHERE user_id = $1
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

export { getRankings, getMyRankings };
