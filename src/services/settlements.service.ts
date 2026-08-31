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
  ticket_id: number;
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

// 유료 이벤트 TOP3 당첨자(tickets.rank <= 3) + gifticon_settlements 지급 여부를 조회 시점에 조인해 계산한다.
// pending 상태는 별도 행을 만들지 않고, gifticon_settlements에 행이 없는 것으로 표현한다.
const SETTLEMENT_BASE_CTE = `
  WITH settlement_base AS (
    SELECT
      t.id AS ticket_id,
      t.event_id,
      e.title AS event_title,
      e.closes_at AS ended_at,
      t.rank,
      t.user_id,
      u.name AS nickname,
      gs.gifticon_id,
      gs.issued_at,
      g.product_name,
      g.face_value,
      CASE WHEN gs.id IS NULL THEN 'pending' ELSE 'issued' END AS status
    FROM tickets t
    JOIN events e ON e.id = t.event_id
    JOIN users u ON u.id = t.user_id
    LEFT JOIN gifticon_settlements gs ON gs.ticket_id = t.id
    LEFT JOIN gifticons g ON g.id = gs.gifticon_id
    WHERE t.event_id IS NOT NULL AND t.rank <= 3
  )
`;

const mapRow = (row: SettlementDbRow): SettlementRow => ({
  id: `st-${row.ticket_id}`,
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

const parseTicketId = (settlementId: string): number => {
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

const getSettlementByTicketId = async (ticketId: number): Promise<SettlementRow> => {
  const result = await pool.query(
    `${SETTLEMENT_BASE_CTE} SELECT * FROM settlement_base WHERE ticket_id = $1`,
    [ticketId],
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
  const ticketId = parseTicketId(settlementId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ticketRes = await client.query(
      `SELECT id FROM tickets WHERE id = $1 AND event_id IS NOT NULL AND rank <= 3 FOR UPDATE`,
      [ticketId],
    );
    if (ticketRes.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new AppError(404, "SETTLEMENT_NOT_FOUND", "정산 내역을 찾을 수 없습니다.");
    }

    const existing = await client.query(
      `SELECT id FROM gifticon_settlements WHERE ticket_id = $1`,
      [ticketId],
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
      `INSERT INTO gifticon_settlements (ticket_id, gifticon_id) VALUES ($1, $2)`,
      [ticketId, gifticonId],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return getSettlementByTicketId(ticketId);
};

export { listSettlements, issueSettlement };
