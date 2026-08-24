import pool from "../config/db";

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface GetMyTicketsParams {
  userId: number;
  page: number;
  limit: number;
}

export interface TicketSummary {
  ticketId: number;
  serial: string;
  seatLabel: string;
  rankNumber: number;
  elapsedMs: number;
  issuedAt: string;
  roundId: number;
  eventId: number;
}

export interface GetMyTicketsResult {
  items: TicketSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface GetTicketByIdParams {
  userId: number;
  ticketId: number;
}

export interface TicketDetail {
  ticketId: number;
  serial: string;
  seatLabel: string;
  rankNumber: number;
  elapsedMs: number;
  issuedAt: string;
  roundId: number;
  eventId: number;
  totalParticipants: number;
  rankPercentile: number | null;
}

/** 서비스 에러 구조: 컨트롤러에서 status / code / message 를 HTTP 응답으로 매핑 */
interface ServiceError extends Error {
  code: string;
  status: number;
}

// ─── 내부 헬퍼 ───────────────────────────────────────────────────────────────

function makeError(code: string, status: number, message: string): ServiceError {
  const err = new Error(message) as ServiceError;
  err.code = code;
  err.status = status;
  return err;
}

// ─── 서비스 함수 ─────────────────────────────────────────────────────────────

/**
 * 내 티켓 목록 조회 (페이지네이션)
 *
 * userId 소유 티켓을 issued_at DESC 정렬로 반환한다.
 * page/limit 기본값은 컨트롤러에서 처리된 값이 넘어온다.
 */
const getMyTickets = async ({
  userId,
  page,
  limit,
}: GetMyTicketsParams): Promise<GetMyTicketsResult> => {
  const offset = (page - 1) * limit;

  const [itemsResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, serial, seat_label, rank, elapsed_ms, issued_at, round_id, event_id
       FROM tickets
       WHERE user_id = $1
       ORDER BY issued_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM tickets WHERE user_id = $1`,
      [userId],
    ),
  ]);

  const items: TicketSummary[] = itemsResult.rows.map((row) => ({
    ticketId: row.id,
    serial: row.serial,
    seatLabel: row.seat_label,
    rankNumber: row.rank,
    elapsedMs: row.elapsed_ms,
    issuedAt: row.issued_at,
    roundId: row.round_id,
    eventId: row.event_id,
  }));

  return {
    items,
    total: countResult.rows[0].total,
    page,
    limit,
  };
};

/**
 * 티켓 단건 조회
 *
 * 티켓이 없으면 TICKET_NOT_FOUND(404),
 * 소유자가 다르면 TICKET_FORBIDDEN(403) 을 throw 한다.
 */
const getTicketById = async ({
  userId,
  ticketId,
}: GetTicketByIdParams): Promise<TicketDetail> => {
  const result = await pool.query(
    `SELECT id, user_id, serial, seat_label, rank, elapsed_ms, issued_at,
            round_id, event_id, total_participants
     FROM tickets
     WHERE id = $1`,
    [ticketId],
  );

  if (result.rows.length === 0) {
    throw makeError("TICKET_NOT_FOUND", 404, "존재하지 않는 티켓입니다.");
  }

  const row = result.rows[0];

  if (row.user_id !== userId) {
    throw makeError("TICKET_FORBIDDEN", 403, "해당 티켓에 접근 권한이 없습니다.");
  }

  const rankNumber: number = row.rank;
  const totalParticipants: number = row.total_participants;
  const rankPercentile: number | null =
    totalParticipants > 0 && rankNumber > 0
      ? Math.round(((totalParticipants - rankNumber + 1) / totalParticipants) * 100 * 10) / 10
      : null;

  return {
    ticketId: row.id,
    serial: row.serial,
    seatLabel: row.seat_label,
    rankNumber,
    elapsedMs: row.elapsed_ms,
    issuedAt: row.issued_at,
    roundId: row.round_id,
    eventId: row.event_id,
    totalParticipants,
    rankPercentile,
  };
};

export { getMyTickets, getTicketById };
