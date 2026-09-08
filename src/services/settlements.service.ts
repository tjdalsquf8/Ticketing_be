import pool from "../config/db";
import { AppError } from "../middlewares/errorHandler";

type SettlementStatus = "pending" | "issued";

type SettlementRow = {
  id: string;
  eventId: number;
  eventTitle: string;
  endedAt: string;
  rank: number;
  userId: number;
  nickname: string;
  status: SettlementStatus;
  gifticonId: number | null;
  productName: string | null;
  faceValue: number | null;
  issuedAt: string | null;
};

type SettlementDbRow = {
  session_id: number;
  event_id: number;
  event_title: string;
  ended_at: string;
  rank: number;
  user_id: number;
  nickname: string;
  status: SettlementStatus;
  gifticon_id: number | null;
  product_name: string | null;
  face_value: number | null;
  issued_at: string | null;
};

// 유료 이벤트 TOP3 당첨자 + gifticon_settlements 지급 여부를 조회 시점에 조인해 계산한다.
// pending 상태는 별도 행을 만들지 않고, gifticon_settlements에 행이 없는 것으로 표현한다.
//
// 순위는 live_sessions.elapsed_ms 로 매 조회 시 계산한다. 예전에는 tickets.rank 를 썼는데,
// 그 값은 좌석 확정 시점에 "그때까지 완주한 사람" 기준으로 매겨진 데다 (event_id, rank)
// unique 충돌 시 MAX(rank)+1 로 밀려서, 실제 3등이 rank 4 로 기록돼 지급 대상에서
// 빠지는 경우가 있었다.
//
// ROW_NUMBER 를 쓰는 이유: RANK 는 동점자가 있으면 이벤트당 3명을 넘길 수 있다.
// 동점 시 먼저 완주한 쪽이 앞선다.
//
// e.status = 'closed' 조건은 필수다. 순위가 더 이상 고정값이 아니라 조회할 때마다
// 재계산되므로, 진행 중인 이벤트를 포함하면 정산 대상 목록이 계속 바뀐다.
const SETTLEMENT_BASE_CTE = `
  WITH ranked AS (
    SELECT
      ls.id AS session_id,
      ls.event_id,
      ls.user_id,
      -- ::int 캐스트 필수. ROW_NUMBER 는 bigint 라 pg 드라이버가 문자열로 돌려주는데,
      -- 예전 tickets.rank 는 smallint(number)였어서 캐스트 없이는 응답 타입이 바뀐다.
      (ROW_NUMBER() OVER (
        PARTITION BY ls.event_id
        ORDER BY ls.elapsed_ms ASC, ls.completed_at ASC
      ))::int AS rank
    FROM public.live_sessions ls
    JOIN public.events e ON e.id = ls.event_id
    WHERE ls.event_id IS NOT NULL
      AND ls.status = 'completed'
      AND ls.user_id IS NOT NULL
      AND e.status = 'closed'
  ),
  settlement_base AS (
    SELECT
      r.session_id,
      r.event_id,
      e.title AS event_title,
      e.closes_at AS ended_at,
      r.rank,
      r.user_id,
      u.name AS nickname,
      gs.gifticon_id,
      gs.issued_at,
      g.product_name,
      g.face_value,
      CASE WHEN gs.id IS NULL THEN 'pending' ELSE 'issued' END AS status
    FROM ranked r
    JOIN public.events e ON e.id = r.event_id
    JOIN public.users u ON u.id = r.user_id
    LEFT JOIN public.gifticon_settlements gs ON gs.live_session_id = r.session_id
    LEFT JOIN public.gifticons g ON g.id = gs.gifticon_id
    WHERE r.rank <= 3
  )
`;

const mapRow = (row: SettlementDbRow): SettlementRow => ({
  id: `st-${row.session_id}`,
  eventId: row.event_id,
  eventTitle: row.event_title,
  endedAt: row.ended_at,
  rank: row.rank,
  userId: row.user_id,
  nickname: row.nickname,
  status: row.status,
  gifticonId: row.gifticon_id,
  productName: row.product_name,
  faceValue: row.face_value,
  issuedAt: row.issued_at,
});

const parseSessionId = (settlementId: string): number => {
  const match = /^st-(\d+)$/.exec(settlementId);
  if (!match) {
    throw new AppError(404, "SETTLEMENT_NOT_FOUND", "정산 내역을 찾을 수 없습니다.");
  }
  return parseInt(match[1], 10);
};

// ─── 목록 조회 ───────────────────────────────────────────────────────────────

const listSettlements = async (params: {
  status?: SettlementStatus;
  eventId?: number;
  page: number;
  size: number;
}): Promise<{ data: SettlementRow[]; totalCount: number }> => {
  const { status, eventId, page, size } = params;
  const offset = (page - 1) * size;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (status) {
    conditions.push(`status = $${idx++}`);
    values.push(status);
  }
  if (eventId !== undefined) {
    conditions.push(`event_id = $${idx++}`);
    values.push(eventId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await pool.query(
    `${SETTLEMENT_BASE_CTE} SELECT COUNT(*)::int AS total FROM settlement_base ${where}`,
    values,
  );

  const dataResult = await pool.query(
    `${SETTLEMENT_BASE_CTE}
     SELECT * FROM settlement_base
     ${where}
     ORDER BY ended_at DESC, event_id, rank
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, size, offset],
  );

  return {
    data: dataResult.rows.map(mapRow),
    totalCount: countResult.rows[0].total,
  };
};

// ─── 단건 조회 (지급 처리 후 응답용) ─────────────────────────────────────────

const getSettlementBySessionId = async (sessionId: number): Promise<SettlementRow> => {
  const result = await pool.query(
    `${SETTLEMENT_BASE_CTE} SELECT * FROM settlement_base WHERE session_id = $1`,
    [sessionId],
  );
  if (result.rows.length === 0) {
    throw new AppError(404, "SETTLEMENT_NOT_FOUND", "정산 내역을 찾을 수 없습니다.");
  }
  return mapRow(result.rows[0]);
};

// ─── 지급 처리 ───────────────────────────────────────────────────────────────

const issueSettlement = async (
  settlementId: string,
  gifticonId: number,
): Promise<SettlementRow> => {
  const sessionId = parseSessionId(settlementId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 지급 직전 재검증: 이 세션이 여전히 TOP3 인지 CTE 로 다시 계산한 뒤,
    // 해당 live_sessions 행을 잠가 동시 지급을 막는다.
    const sessionRes = await client.query(
      `${SETTLEMENT_BASE_CTE}
       SELECT ls.id
       FROM settlement_base sb
       JOIN public.live_sessions ls ON ls.id = sb.session_id
       WHERE sb.session_id = $1
       FOR UPDATE OF ls`,
      [sessionId],
    );
    if (sessionRes.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new AppError(404, "SETTLEMENT_NOT_FOUND", "정산 내역을 찾을 수 없습니다.");
    }

    const existing = await client.query(
      `SELECT id FROM gifticon_settlements WHERE live_session_id = $1`,
      [sessionId],
    );
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      throw new AppError(409, "SETTLEMENT_ALREADY_ISSUED", "이미 지급 완료된 정산 내역입니다.");
    }

    const gifticonRes = await client.query(
      `SELECT id, status FROM gifticons WHERE id = $1 FOR UPDATE`,
      [gifticonId],
    );
    if (gifticonRes.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new AppError(404, "GIFTICON_NOT_FOUND", "재고를 찾을 수 없습니다.");
    }
    if (gifticonRes.rows[0].status !== "available") {
      await client.query("ROLLBACK");
      throw new AppError(
        409,
        "GIFTICON_NOT_AVAILABLE",
        "available 상태인 재고만 지급할 수 있습니다.",
      );
    }

    await client.query(
      `UPDATE gifticons SET status = 'issued', updated_at = NOW() WHERE id = $1`,
      [gifticonId],
    );
    await client.query(
      `INSERT INTO gifticon_settlements (live_session_id, gifticon_id) VALUES ($1, $2)`,
      [sessionId, gifticonId],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return getSettlementBySessionId(sessionId);
};

export { listSettlements, issueSettlement };
