import pool from "../config/db";

const ROUND_DURATION_MINUTES = 5;

// 방어적 런타임 단언: 이 상수가 실수로 문자열/외부값으로 바뀌어도 SQL 인젝션 경로가 열리지 않도록
// 모듈 로드 시점에 정수 & 안전 범위(1~120)임을 강제한다.
if (
  !Number.isInteger(ROUND_DURATION_MINUTES) ||
  ROUND_DURATION_MINUTES < 1 ||
  ROUND_DURATION_MINUTES > 120
) {
  throw new Error(
    `[live.service] ROUND_DURATION_MINUTES must be an integer in [1,120], got ${ROUND_DURATION_MINUTES}`,
  );
}

type RoundSummary = {
  roundId: number;
  opensAt: string;
  closesAt: string;
  status: "scheduled" | "open" | "closed" | "cancelled";
  totalSeats: number;
  venueId: string;  // slug 문자열
};

const mapRound = (row: {
  id: number;
  opens_at: string;
  closes_at: string;
  status: RoundSummary["status"];
  seat_labels: string[];
  venue_slug?: string;
}): RoundSummary => ({
  roundId: row.id,
  opensAt: row.opens_at,
  closesAt: row.closes_at,
  status: row.status,
  totalSeats: Array.isArray(row.seat_labels) ? row.seat_labels.length : 0,
  venueId: row.venue_slug ?? "",
});

// ─── Scheduler operations (called from cron) ─────────────────

// KST 오늘 자정 이내 정각 회차 미리 생성.
// - fromMidnight=true : KST 오늘 00시 ~ 23시 (크론 매일 00시 호출용)
// - fromMidnight=false: 다음 정각 ~ KST 오늘 23시 (서버 부팅 시 남은 오늘 슬롯만 채움)
// - live_config 없으면 CROSS JOIN 결과 0행 → 아무것도 안 만듦 (부트스트랩 안전 가드)
// - excluded_hours (KST 기준 0~23시)에 해당하는 정각은 생성 스킵
// - venue_id 는 live_config.default_venue_id 를 그대로 복사 (events 결합 없음)
// - 관리자가 config를 갱신하면 이후 정각부터 새 venue/seat로 반영됨 (기존 회차는 스냅샷 유지)
// - 기존 회차 존재 시 ON CONFLICT (opens_at) DO NOTHING
const ensureUpcomingRounds = async (
  fromMidnight: boolean = false,
): Promise<void> => {
  // startExpr 은 boolean 분기로 선택되는 2개의 리터럴 SQL 조각뿐이라 인젝션 경로 없음.
  // ⚠️ 어떤 경우에도 외부 입력(req.body/query/env)을 이 변수로 전달하지 말 것.
  const startExpr = fromMidnight
    ? `date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'`
    : `date_trunc('hour', NOW()) + INTERVAL '1 hour'`;
  // ROUND_DURATION_MINUTES 는 파라미터 바인딩($1)으로 전달해 문자열 인터폴레이션을 제거.
  // make_interval(mins => $1) 로 안전하게 INTERVAL 로 변환.
  await pool.query(
    `INSERT INTO live_rounds (opens_at, closes_at, venue_id, seat_labels, status)
     SELECT slot.ts,
            slot.ts + make_interval(mins => $1::int),
            cfg.default_venue_id,
            cfg.default_seat_labels,
            'scheduled'
     FROM generate_series(
            ${startExpr},
            (date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul') + INTERVAL '23 hours',
            INTERVAL '1 hour'
          ) AS slot(ts)
     CROSS JOIN (
       SELECT default_venue_id, default_seat_labels, excluded_hours FROM live_config WHERE id = 1
     ) cfg
     WHERE NOT (
       EXTRACT(HOUR FROM slot.ts AT TIME ZONE 'Asia/Seoul')::int = ANY(cfg.excluded_hours)
     )
     ON CONFLICT (opens_at) DO NOTHING`,
    [ROUND_DURATION_MINUTES],
  );
};

// 회차 상태 전이:
// - scheduled → open + live_seats 벌크 INSERT (한 CTE로 원자 처리)
// - open → closed (Phase 7에서 티켓 배치 훅이 여기 추가됨)
const transitionRounds = async (): Promise<void> => {
  await pool.query(
    `WITH promoted AS (
       UPDATE live_rounds SET status = 'open'
       WHERE status = 'scheduled' AND opens_at <= NOW()
       RETURNING id, seat_labels
     )
     INSERT INTO live_seats (round_id, seat_label)
     SELECT p.id, label
     FROM promoted p
     CROSS JOIN LATERAL jsonb_array_elements_text(p.seat_labels) AS label
     ON CONFLICT (round_id, seat_label) DO NOTHING`,
  );

  await pool.query(
    `UPDATE live_rounds SET status = 'closed'
     WHERE status = 'open' AND closes_at <= NOW()`,
  );
};

// ─── Public queries (홈/랜딩용) ─────────────────────────────

// GET /api/live/current — 지금 진행중 회차 (없으면 null)
const getCurrent = async (): Promise<RoundSummary | null> => {
  const result = await pool.query(
    `SELECT r.id, r.opens_at, r.closes_at, r.status, r.seat_labels,
            v.slug AS venue_slug
     FROM live_rounds r
     JOIN public.venues v ON v.id = r.venue_id
     WHERE r.status = 'open'
     ORDER BY r.opens_at DESC
     LIMIT 1`,
  );
  return result.rows[0] ? mapRound(result.rows[0]) : null;
};

// GET /api/live/next — 다음 예정 회차 (없으면 null)
const getNext = async (): Promise<RoundSummary | null> => {
  const result = await pool.query(
    `SELECT r.id, r.opens_at, r.closes_at, r.status, r.seat_labels,
            v.slug AS venue_slug
     FROM live_rounds r
     JOIN public.venues v ON v.id = r.venue_id
     WHERE r.status = 'scheduled' AND r.opens_at > NOW()
     ORDER BY r.opens_at ASC
     LIMIT 1`,
  );
  return result.rows[0] ? mapRound(result.rows[0]) : null;
};

// GET /api/live/last-round?limit=N — 가장 최근 종료 회차 1개 + 상위 N명 랭킹
type RankingEntry = {
  rank: number;
  nickname: string;
  seatLabel: string | null;
  elapsedMs: number;
  isMember: boolean;
};

type LastRoundResult = {
  round: RoundSummary;
  rankings: RankingEntry[];
};

const getLastRoundTopN = async (
  limit: number,
): Promise<LastRoundResult | null> => {
  const roundRes = await pool.query(
    `SELECT r.id, r.opens_at, r.closes_at, r.status, r.seat_labels,
            v.slug AS venue_slug
     FROM live_rounds r
     JOIN public.venues v ON v.id = r.venue_id
     WHERE r.status = 'closed'
     ORDER BY r.closes_at DESC
     LIMIT 1`,
  );
  if (roundRes.rows.length === 0) return null;

  const round = mapRound(roundRes.rows[0]);

  const sessionsRes = await pool.query(
    `SELECT nickname, seat_label, elapsed_ms, user_id
     FROM live_sessions
     WHERE round_id = $1 AND status = 'completed'
     ORDER BY elapsed_ms ASC, completed_at ASC
     LIMIT $2`,
    [round.roundId, limit],
  );

  const rankings: RankingEntry[] = sessionsRes.rows.map((row, index) => ({
    rank: index + 1,
    nickname: row.nickname,
    seatLabel: row.seat_label,
    elapsedMs: row.elapsed_ms,
    isMember: row.user_id !== null,
  }));

  return { round, rankings };
};

// GET /api/live/rounds/:roundId — 특정 회차 상세 조회
const getRoundById = async (roundId: number): Promise<RoundSummary | null> => {
  const result = await pool.query(
    `SELECT r.id, r.opens_at, r.closes_at, r.status, r.seat_labels,
            v.slug AS venue_slug
     FROM live_rounds r
     JOIN public.venues v ON v.id = r.venue_id
     WHERE r.id = $1`,
    [roundId],
  );
  return result.rows[0] ? mapRound(result.rows[0]) : null;
};

export type MyParticipation = {
  sessionId: string;
  status: "queued" | "active" | "completed";
  queuePosition: number | null;
  seatLabel: string | null;
  elapsedMs: number | null;
};

/**
 * 요청자가 이 회차에 이미 참여했는지 조회한다.
 *
 * 대상 상태는 세션 생성(createSession) 이 중복 판정에 쓰는 집합과 같은
 * queued/active/completed 다. `uq_live_sessions_round_user_active` /
 * `uq_live_sessions_round_guest_active` 부분 유니크 인덱스가 이 세 상태에서
 * (round, 참가자) 조합을 하나로 강제하므로 결과는 최대 1행이다.
 *
 * 회원은 user_id, 게스트는 guest_uuid 쿠키로 식별한다. 둘 다 없으면 조회 없이 null.
 */
const getMyParticipation = async (
  roundId: number,
  identity: { userId?: number | null; guestUuid?: string | null },
): Promise<MyParticipation | null> => {
  const { userId, guestUuid } = identity;
  if (userId == null && !guestUuid) return null;

  const column = userId != null ? "user_id" : "guest_uuid";
  const value = userId != null ? userId : guestUuid;

  const result = await pool.query(
    `SELECT session_id, status, queue_position, seat_label, elapsed_ms
     FROM live_sessions
     WHERE round_id = $1 AND ${column} = $2
       AND status IN ('queued', 'active', 'completed')`,
    [roundId, value],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    sessionId: row.session_id as string,
    status: row.status as MyParticipation["status"],
    queuePosition: (row.queue_position ?? null) as number | null,
    seatLabel: (row.seat_label ?? null) as string | null,
    elapsedMs: (row.elapsed_ms ?? null) as number | null,
  };
};

// ─── 관리자 통계 ─────────────────────────────────────────────────────────────

export interface RoundStatsRow {
  roundId: number;
  status: string;
  registered: number;
  completed: number;
  noShow: number;
}

/**
 * 관리자 라이브 라운드 통계 (결과 집계 전용).
 *
 * 필드:
 *   registered — 그 라운드에 참여 시도한 총 세션 수 (상태 무관).
 *   completed  — 좌석 확정까지 완주한 세션 수.
 *   noShow     — active 진입 후 좌석 확정 못 한 세션 수
 *                (live_sessions.status != 'completed' — queued/active/failed 포함).
 *
 * 라이브 세션은 completed = 좌석 확정 완료. 그 외 상태는 좌석을 못 잡은 것.
 */
const getRoundStats = async (roundId: number): Promise<RoundStatsRow> => {
  // 라운드 존재 여부 확인
  const roundRes = await pool.query(
    `SELECT status FROM live_rounds WHERE id = $1`,
    [roundId],
  );
  if (roundRes.rows.length === 0) {
    const err = new Error("회차를 찾을 수 없습니다") as Error & {
      code: string;
      status: number;
    };
    err.code = "ROUND_NOT_FOUND";
    err.status = 404;
    throw err;
  }

  // 세션 집계: 한 쿼리로 registered / completed / noShow 산출
  const sessionStatsRes = await pool.query(
    `SELECT
       COUNT(*)                                        AS registered,
       COUNT(*) FILTER (WHERE status =  'completed')  AS completed,
       COUNT(*) FILTER (WHERE status != 'completed')  AS no_show
     FROM live_sessions
     WHERE round_id = $1`,
    [roundId],
  );

  const sRow = sessionStatsRes.rows[0];

  return {
    roundId,
    status:     roundRes.rows[0].status as string,
    registered: parseInt(sRow.registered, 10),
    completed:  parseInt(sRow.completed,  10),
    noShow:     parseInt(sRow.no_show,    10),
  };
};

export {
  ROUND_DURATION_MINUTES,
  ensureUpcomingRounds,
  transitionRounds,
  getCurrent,
  getNext,
  getLastRoundTopN,
  getRoundById,
  getMyParticipation,
  getRoundStats,
};
