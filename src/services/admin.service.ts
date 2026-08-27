import pool from "../config/db";
import { AppError } from "../middlewares/errorHandler";

// ─── Live Config ─────────────────────────────────────────────

type LiveConfig = {
  defaultVenueId: number;
  defaultSeatLabels: string[];
  excludedHours: number[];
  updatedBy: number | null;
  updatedAt: string;
};

const getLiveConfig = async (): Promise<LiveConfig> => {
  const result = await pool.query(
    `SELECT default_venue_id, default_seat_labels, excluded_hours, updated_by, updated_at
     FROM live_config WHERE id = 1`,
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(
      404,
      "CONFIG_NOT_INITIALIZED",
      "설정이 초기화되지 않았습니다. PUT /admin/live/config/venue 로 먼저 저장하세요.",
    );
  }
  return {
    defaultVenueId: row.default_venue_id,
    defaultSeatLabels: row.default_seat_labels,
    excludedHours: row.excluded_hours ?? [],
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
};

// 공연장·좌석 배치만 UPSERT (excluded_hours는 건드리지 않음)
// - INSERT 시엔 excluded_hours가 DEFAULT ARRAY[]::int[]로 자동 채워짐
// - UPDATE 시엔 venue/seat 컬럼만 갱신
const upsertLiveConfigVenue = async (params: {
  defaultVenueId: number;
  defaultSeatLabels: string[];
  updatedBy: number;
}): Promise<LiveConfig> => {
  const { defaultVenueId, defaultSeatLabels, updatedBy } = params;
  const result = await pool.query(
    `INSERT INTO live_config (id, default_venue_id, default_seat_labels, updated_by, updated_at)
     VALUES (1, $1, $2::jsonb, $3, NOW())
     ON CONFLICT (id) DO UPDATE
       SET default_venue_id = EXCLUDED.default_venue_id,
           default_seat_labels = EXCLUDED.default_seat_labels,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
     RETURNING default_venue_id, default_seat_labels, excluded_hours, updated_by, updated_at`,
    [defaultVenueId, JSON.stringify(defaultSeatLabels), updatedBy],
  );
  const row = result.rows[0];
  return {
    defaultVenueId: row.default_venue_id,
    defaultSeatLabels: row.default_seat_labels,
    excludedHours: row.excluded_hours ?? [],
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
};

// 스케줄만 UPDATE (venue 관련 컬럼은 건드리지 않음)
// - config row 없으면 venue 먼저 세팅 요구 (409 LIVE_CONFIG_NOT_INITIALIZED)
const updateLiveConfigSchedule = async (params: {
  excludedHours: number[];
  updatedBy: number;
}): Promise<LiveConfig> => {
  const { excludedHours, updatedBy } = params;
  const result = await pool.query(
    `UPDATE live_config
     SET excluded_hours = $1::int[],
         updated_by = $2,
         updated_at = NOW()
     WHERE id = 1
     RETURNING default_venue_id, default_seat_labels, excluded_hours, updated_by, updated_at`,
    [excludedHours, updatedBy],
  );
  if (result.rows.length === 0) {
    throw new AppError(
      409,
      "LIVE_CONFIG_NOT_INITIALIZED",
      "공연장 배치를 먼저 저장해주세요.",
    );
  }
  const row = result.rows[0];
  return {
    defaultVenueId: row.default_venue_id,
    defaultSeatLabels: row.default_seat_labels,
    excludedHours: row.excluded_hours ?? [],
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
};

// ─── Live Rounds ─────────────────────────────────────────────

type RoundRow = {
  id: number;
  opensAt: string;
  closesAt: string;
  status: "scheduled" | "open" | "closed" | "cancelled";
  createdAt: string;
};

type RoundListRow = RoundRow & { participantCount: number };

const mapRoundRow = (row: {
  id: number;
  opens_at: string;
  closes_at: string;
  status: "scheduled" | "open" | "closed" | "cancelled";
  created_at: string;
}): RoundRow => ({
  id: row.id,
  opensAt: row.opens_at,
  closesAt: row.closes_at,
  status: row.status,
  createdAt: row.created_at,
});

const listRounds = async (params: {
  from?: string;
  to?: string;
  date?: string;
}): Promise<RoundListRow[]> => {
  const { from, to, date } = params;
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (date) {
    values.push(date);
    conditions.push(
      `r.opens_at >= ($${values.length})::date AND r.opens_at < (($${values.length})::date + INTERVAL '1 day')`,
    );
  } else {
    if (from) {
      values.push(from);
      conditions.push(`r.opens_at >= $${values.length}`);
    }
    if (to) {
      values.push(to);
      conditions.push(`r.opens_at < $${values.length}`);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT r.id, r.opens_at, r.closes_at, r.status, r.created_at,
            COALESCE(s.count, 0)::int AS participant_count
     FROM live_rounds r
     LEFT JOIN (
       SELECT round_id, COUNT(*) AS count
       FROM live_sessions
       GROUP BY round_id
     ) s ON s.round_id = r.id
     ${where}
     ORDER BY r.opens_at ASC`,
    values,
  );
  return result.rows.map((row) => ({
    ...mapRoundRow(row),
    participantCount: row.participant_count,
  }));
};

// 원자적 취소: SELECT 후 UPDATE 사이 cron transitionRounds가 scheduled → open으로
// 승격시키는 TOCTOU 경합을 방지하기 위해 WHERE status='scheduled' 조건을 UPDATE에 포함.
// rowCount === 0 이면 (a) 존재하지 않거나 (b) 이미 open/closed/cancelled 상태.
// 원인을 구분하기 위해 추가 SELECT 한 번만 실행.
const cancelRound = async (roundId: number): Promise<RoundRow> => {
  const result = await pool.query(
    `UPDATE live_rounds SET status = 'cancelled'
     WHERE id = $1 AND status = 'scheduled'
     RETURNING id, opens_at, closes_at, status, created_at`,
    [roundId],
  );

  if (result.rows.length === 0) {
    const existing = await pool.query(
      `SELECT status FROM live_rounds WHERE id = $1`,
      [roundId],
    );
    if (existing.rows.length === 0) {
      throw new AppError(404, "ROUND_NOT_FOUND", "회차를 찾을 수 없습니다.");
    }
    throw new AppError(
      409,
      "ROUND_NOT_CANCELLABLE",
      "예정된(scheduled) 회차만 취소할 수 있습니다.",
    );
  }

  return mapRoundRow(result.rows[0]);
};

type RoundDetail = {
  round: RoundRow & { seatLabels: string[] };
  waitingCount: number;
  seatsSummary: { available: number; held: number; sold: number };
  top10: Array<{
    rank: number;
    nickname: string;
    seatLabel: string | null;
    elapsedMs: number;
    isMember: boolean;
  }>;
};

const getRoundDetail = async (roundId: number): Promise<RoundDetail> => {
  const roundResult = await pool.query(
    `SELECT id, opens_at, closes_at, seat_labels, status, created_at
     FROM live_rounds WHERE id = $1`,
    [roundId],
  );
  if (roundResult.rows.length === 0) {
    throw new AppError(404, "ROUND_NOT_FOUND", "회차를 찾을 수 없습니다.");
  }
  const r = roundResult.rows[0];

  const [waitingResult, seatsResult, topResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS count FROM live_waiting WHERE round_id = $1`,
      [roundId],
    ),
    pool.query(
      `SELECT status, COUNT(*)::int AS count
       FROM live_seats WHERE round_id = $1
       GROUP BY status`,
      [roundId],
    ),
    pool.query(
      // session_id 는 응답에 필요 없음 (내부 식별자). nickname/seat/elapsed/user_id 만 반환.
      `SELECT nickname, seat_label, elapsed_ms, user_id
       FROM live_sessions
       WHERE round_id = $1 AND status = 'completed'
       ORDER BY elapsed_ms ASC
       LIMIT 10`,
      [roundId],
    ),
  ]);

  const seatsSummary = { available: 0, held: 0, sold: 0 };
  for (const row of seatsResult.rows) {
    if (row.status in seatsSummary) {
      (seatsSummary as Record<string, number>)[row.status] = row.count;
    }
  }

  return {
    round: {
      id: r.id,
      opensAt: r.opens_at,
      closesAt: r.closes_at,
      seatLabels: r.seat_labels,
      status: r.status,
      createdAt: r.created_at,
    },
    waitingCount: waitingResult.rows[0].count,
    seatsSummary,
    top10: topResult.rows.map((row, idx) => ({
      rank: idx + 1,
      nickname: row.nickname,
      seatLabel: row.seat_label,
      elapsedMs: row.elapsed_ms,
      isMember: row.user_id !== null,
    })),
  };
};

export {
  getLiveConfig,
  upsertLiveConfigVenue,
  updateLiveConfigSchedule,
  listRounds,
  cancelRound,
  getRoundDetail,
};
