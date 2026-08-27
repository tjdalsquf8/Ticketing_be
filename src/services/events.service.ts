import crypto from "crypto";
import pool from "../config/db";
import config from "../config";
import type { PoolClient } from "pg";
import { scheduleEvent, cancelScheduledEvent } from "../jobs/eventScheduler";

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface EventRow {
  eventId: number;
  type: string;
  category: string;
  title: string;
  venueId: string;       // slug 문자열 (예: "kspo-dome-v1")
  venueName: string;
  venueLayout: string;
  totalSeats: number;
  opensAt: string;
  closesAt: string;
  durationMs: number;
  entryFeePoints: number;
  registrationDeadline: string;
  prize: string;
  posterColor: string;
  posterInitial: string;
  status: string;
  seriesId: number | null;
  registeredCount: number;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  hiddenAt: string | null;
}

export interface EventRegistrationRow {
  registrationId: number;
  eventId: number;
  userId: number;
  pointsPaid: number;
  registeredAt: string;
  status: string;
  ticketId: number | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  refundPoints: number | null;
}

export interface VenueRow {
  venueId: string;       // slug 문자열
  name: string;
  layout: string;
  totalSeats: number;
  thumbnailUrl: string | null;
}

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

/**
 * opensAt(UTC ISO string)을 받아 registrationDeadline(UTC)을 반환한다.
 * 규칙: opensAt을 KST로 변환 → 그 날 00:00 KST → 하루 전 → UTC 반환
 * 예: opensAt = 2026-08-15T20:00+09:00 → 2026-08-13T15:00Z
 */
function calcRegistrationDeadline(opensAt: string): Date {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const opensAtMs = new Date(opensAt).getTime();
  // KST 자정(그 날 00:00 KST) 구하기
  const opensAtKstMs = opensAtMs + KST_OFFSET_MS;
  const kstMidnight = new Date(
    Math.floor(opensAtKstMs / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000),
  );
  // 하루 전 KST 00:00 → UTC
  const deadlineUtcMs = kstMidnight.getTime() - KST_OFFSET_MS - 24 * 60 * 60 * 1000;
  return new Date(deadlineUtcMs);
}

/**
 * DB 로우(snake_case)를 카멜케이스 EventRow로 변환한다.
 * venueId는 slug 문자열로 반환한다.
 */
function mapEvent(row: Record<string, unknown>): EventRow {
  return {
    eventId:              row.id as number,
    type:                 row.type as string,
    category:             row.category as string,
    title:                row.title as string,
    venueId:              (row.venue_slug ?? "") as string,
    venueName:            (row.venue_name ?? "") as string,
    venueLayout:          (row.venue_layout ?? "") as string,
    totalSeats:           row.total_seats as number,
    opensAt:              (row.opens_at as Date).toISOString(),
    closesAt:             (row.closes_at as Date).toISOString(),
    durationMs:           row.duration_ms as number,
    entryFeePoints:       row.entry_fee_points as number,
    registrationDeadline: (row.registration_deadline as Date).toISOString(),
    prize:                row.prize as string,
    posterColor:          row.poster_color as string,
    posterInitial:        row.poster_initial as string,
    status:               row.status as string,
    seriesId:             (row.series_id ?? null) as number | null,
    registeredCount:      row.registered_count as number,
    createdBy:            row.created_by as number,
    createdAt:            (row.created_at as Date).toISOString(),
    updatedAt:            (row.updated_at as Date).toISOString(),
    cancelledAt:          row.cancelled_at ? (row.cancelled_at as Date).toISOString() : null,
    cancelReason:         (row.cancel_reason ?? null) as string | null,
    hiddenAt:             row.hidden_at ? (row.hidden_at as Date).toISOString() : null,
  };
}

/**
 * DB 로우(snake_case)를 카멜케이스 EventRegistrationRow로 변환한다.
 */
function mapRegistration(row: Record<string, unknown>): EventRegistrationRow {
  return {
    registrationId: row.id as number,
    eventId:        row.event_id as number,
    userId:         row.user_id as number,
    pointsPaid:     row.points_paid as number,
    registeredAt:   (row.registered_at as Date).toISOString(),
    status:         row.status as string,
    ticketId:       (row.ticket_id ?? null) as number | null,
    cancelledAt:    row.cancelled_at ? (row.cancelled_at as Date).toISOString() : null,
    refundedAt:     row.refunded_at  ? (row.refunded_at  as Date).toISOString() : null,
    refundPoints:   (row.refund_points ?? null) as number | null,
  };
}

/** SELECT 절 — events + venue JOIN (venueId = slug) */
const EVENT_SELECT = `
  e.id, e.type, e.category, e.title,
  v.slug AS venue_slug, v.name AS venue_name, v.layout AS venue_layout,
  e.total_seats, e.opens_at, e.closes_at, e.duration_ms, e.entry_fee_points,
  e.registration_deadline, e.prize, e.poster_color, e.poster_initial,
  e.status, e.series_id, e.registered_count, e.created_by,
  e.created_at, e.updated_at, e.cancelled_at, e.cancel_reason, e.hidden_at
`;

// ─── 공개 API 서비스 ─────────────────────────────────────────────────────────

/**
 * 1. 이벤트 목록 조회 (type='live' 제외)
 */
async function listEvents(params: {
  status?: string;
  category?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}): Promise<{ data: EventRow[]; totalCount: number }> {
  const { status, category, from, to, page, limit } = params;
  const offset = (page - 1) * limit;

  const conditions: string[] = ["e.type != 'live'", "e.hidden_at IS NULL"];
  const values: unknown[] = [];
  let idx = 1;

  if (status) {
    conditions.push(`e.status = $${idx++}`);
    values.push(status);
  }
  if (category) {
    conditions.push(`e.category = $${idx++}`);
    values.push(category);
  }
  if (from) {
    conditions.push(`e.opens_at >= $${idx++}`);
    values.push(from);
  }
  if (to) {
    conditions.push(`e.opens_at <= $${idx++}`);
    values.push(to);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM public.events e ${where}`,
    values,
  );
  const totalCount = parseInt(countRes.rows[0].count, 10);

  const dataRes = await pool.query(
    `SELECT ${EVENT_SELECT}
     FROM public.events e
     JOIN public.venues v ON v.id = e.venue_id
     ${where}
     ORDER BY e.opens_at ASC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, limit, offset],
  );

  return { data: dataRes.rows.map(mapEvent), totalCount };
}

/**
 * 2. 월간 캘린더 조회
 * ym: 'YYYY-MM' (KST 기준)
 */
async function getCalendar(ym: string): Promise<{
  ym: string;
  days: { date: string; events: Partial<EventRow>[] }[];
}> {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

  // KST 달의 첫날/마지막날 → UTC 범위
  const [year, month] = ym.split("-").map(Number);
  const kstMonthStart = new Date(Date.UTC(year, month - 1, 1) - KST_OFFSET_MS); // KST 1일 00:00 = UTC 전날 15:00
  const kstMonthEnd   = new Date(Date.UTC(year, month, 1) - KST_OFFSET_MS);      // KST 말일+1일 00:00 → exclusive

  const res = await pool.query(
    `SELECT e.id, e.title, e.prize, e.category, e.opens_at, e.status
     FROM public.events e
     WHERE e.type != 'live'
       AND e.hidden_at IS NULL
       AND e.opens_at >= $1
       AND e.opens_at <  $2
     ORDER BY e.opens_at ASC`,
    [kstMonthStart.toISOString(), kstMonthEnd.toISOString()],
  );

  // 달의 모든 날짜 초기화
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dayMap = new Map<string, Partial<EventRow>[]>();
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${ym}-${String(d).padStart(2, "0")}`;
    dayMap.set(dateStr, []);
  }

  // 각 이벤트를 KST 날짜 기준으로 분류
  for (const row of res.rows) {
    const kstDate = new Date(new Date(row.opens_at).getTime() + KST_OFFSET_MS);
    const dateStr = kstDate.toISOString().substring(0, 10);
    if (dayMap.has(dateStr)) {
      dayMap.get(dateStr)!.push({
        eventId:  row.id,
        title:    row.title,
        prize:    row.prize,
        category: row.category,
        opensAt:  new Date(row.opens_at).toISOString(),
        status:   row.status,
      });
    }
  }

  const days = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, events]) => ({ date, events }));

  return { ym, days };
}

/**
 * 3. 가장 가까운 예정 이벤트 (nearest)
 */
async function getNearestEvent(): Promise<EventRow | null> {
  const res = await pool.query(
    `SELECT ${EVENT_SELECT}
     FROM public.events e
     JOIN public.venues v ON v.id = e.venue_id
     WHERE e.type != 'live'
       AND e.hidden_at IS NULL
       AND e.status = 'scheduled'
       AND e.registration_deadline > NOW()
     ORDER BY e.opens_at ASC
     LIMIT 1`,
  );
  if (res.rows.length === 0) return null;
  return mapEvent(res.rows[0]);
}

/**
 * 4. 이벤트 상세
 */
async function getEventById(
  eventId: number,
  userId?: number | null,
): Promise<EventRow & { myRegistration: EventRegistrationRow | null }> {
  const res = await pool.query(
    `SELECT ${EVENT_SELECT}
     FROM public.events e
     JOIN public.venues v ON v.id = e.venue_id
     WHERE e.id = $1`,
    [eventId],
  );
  if (res.rows.length === 0) {
    throw makeError("EVENT_NOT_FOUND", 404, "이벤트를 찾을 수 없습니다.");
  }

  const event = mapEvent(res.rows[0]);

  // hidden 이벤트는 공개 조회에서 없는 것으로 취급 (관리자용은 별도 admin 서비스 사용).
  if (event.hiddenAt !== null) {
    throw makeError("EVENT_NOT_FOUND", 404, "이벤트를 찾을 수 없습니다.");
  }

  let myRegistration: EventRegistrationRow | null = null;
  if (userId != null) {
    const regRes = await pool.query(
      `SELECT * FROM public.event_registrations
       WHERE event_id = $1 AND user_id = $2
         AND status IN ('pending','entered','ticketed','missed','no_show')
       LIMIT 1`,
      [eventId, userId],
    );
    if (regRes.rows.length > 0) {
      myRegistration = mapRegistration(regRes.rows[0]);
    }
  }

  return { ...event, myRegistration };
}

/**
 * 5. 참여 신청 (포인트 차감 + 등록)
 *
 * 이벤트 상태/마감 검증을 트랜잭션 내 SELECT FOR UPDATE 로 처리한다.
 * 검증 통과 후 이벤트가 cancelled/closed 되는 TOCTOU 레이스 컨디션을 방지한다.
 */
async function registerEvent(
  eventId: number,
  userId: number,
): Promise<EventRegistrationRow> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    // 이벤트 로우 락: 검증~INSERT 사이 상태 변경 방지
    const eventRes = await client.query(
      `SELECT id, status, entry_fee_points, registration_deadline
       FROM public.events
       WHERE id = $1
       FOR UPDATE`,
      [eventId],
    );
    if (eventRes.rows.length === 0) {
      await client.query("ROLLBACK");
      throw makeError("EVENT_NOT_FOUND", 404, "이벤트를 찾을 수 없습니다.");
    }
    const event = eventRes.rows[0];

    // 이슈 5: cancelled 상태를 별도 분기 처리
    if (event.status === "cancelled") {
      await client.query("ROLLBACK");
      throw makeError("EVENT_CANCEL_FORBIDDEN", 409, "취소된 이벤트입니다.");
    }
    if (event.status === "open") {
      await client.query("ROLLBACK");
      throw makeError("EVENT_ALREADY_STARTED", 409, "이미 시작된 이벤트입니다.");
    }
    if (event.status === "closed") {
      await client.query("ROLLBACK");
      throw makeError("EVENT_ALREADY_CLOSED", 409, "종료된 이벤트입니다.");
    }
    if (event.status !== "scheduled") {
      await client.query("ROLLBACK");
      throw makeError("EVENT_ALREADY_CLOSED", 409, "신청할 수 없는 상태의 이벤트입니다.");
    }

    const now = new Date();
    if (now >= new Date(event.registration_deadline)) {
      await client.query("ROLLBACK");
      throw makeError("REGISTRATION_CLOSED", 409, "사전 신청이 마감되었습니다.");
    }

    // 중복 신청 검사 (트랜잭션 내)
    const dupRes = await client.query(
      `SELECT id FROM public.event_registrations
       WHERE event_id = $1 AND user_id = $2
         AND status IN ('pending','entered','ticketed','missed','no_show')`,
      [eventId, userId],
    );
    if (dupRes.rows.length > 0) {
      await client.query("ROLLBACK");
      throw makeError("ALREADY_REGISTERED", 409, "이미 신청한 이벤트입니다.");
    }

    const entryFeePoints: number = event.entry_fee_points;

    // 포인트 잔액 확인 + 차감 (원자적 UPDATE)
    const pointsRes = await client.query(
      `UPDATE public.users
       SET points = points - $1
       WHERE id = $2 AND points >= $1
       RETURNING points`,
      [entryFeePoints, userId],
    );
    if ((pointsRes.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      throw makeError("INSUFFICIENT_POINTS", 409, "포인트가 부족합니다.");
    }

    // 신청 레코드 생성
    const regRes = await client.query(
      `INSERT INTO public.event_registrations
         (event_id, user_id, points_paid, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [eventId, userId, entryFeePoints],
    );

    // registeredCount 증가
    await client.query(
      `UPDATE public.events SET registered_count = registered_count + 1, updated_at = NOW()
       WHERE id = $1`,
      [eventId],
    );

    await client.query("COMMIT");
    return mapRegistration(regRes.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 6. 내 신청 취소 · 환불
 *
 * 이중 환불 방지: 조건부 UPDATE ... RETURNING 으로 상태 전환과 취소 대상 선정을
 * 하나의 원자적 SQL 로 처리한다. SELECT→UPDATE 두 단계 사이에 다른 프로세스가
 * (관리자 cancelEvent, 이벤트 취소 크론 등) 같은 registration 을 'refunded'로 변경해
 * 발생할 수 있는 이중 환불(TOCTOU)을 차단한다.
 */
async function cancelMyRegistration(
  eventId: number,
  userId: number,
): Promise<EventRegistrationRow> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    // status='pending' 이면서 opens_at > NOW() 인 행만 원자적으로 cancelled 처리.
    // 다른 트랜잭션이 이미 refunded/cancelled 로 바꿨다면 rowCount=0.
    const updated = await client.query(
      `UPDATE public.event_registrations er
       SET status = 'cancelled',
           cancelled_at = NOW(),
           refunded_at = NOW(),
           refund_points = er.points_paid
       FROM public.events e
       WHERE er.event_id = $1
         AND er.user_id = $2
         AND er.status = 'pending'
         AND e.id = er.event_id
         AND e.opens_at > NOW()
       RETURNING er.*`,
      [eventId, userId],
    );

    if ((updated.rowCount ?? 0) === 0) {
      // 실패 원인 구분: 신청 자체가 없는지 / 이미 처리됐는지 / 오픈 이후인지.
      // 트랜잭션 롤백 후 별도 SELECT 로 상태 판별.
      await client.query("ROLLBACK");

      const eventRes = await pool.query(
        `SELECT opens_at FROM public.events WHERE id = $1`,
        [eventId],
      );
      if (eventRes.rows.length > 0 && new Date() >= new Date(eventRes.rows[0].opens_at)) {
        throw makeError("CANCEL_NOT_ALLOWED", 409, "오픈 이후에는 취소할 수 없습니다.");
      }
      throw makeError("REGISTRATION_NOT_FOUND", 404, "취소할 신청 내역이 없습니다.");
    }

    const reg = updated.rows[0];
    const refundPoints: number = reg.points_paid;

    // 포인트 환불
    await client.query(
      `UPDATE public.users SET points = points + $1 WHERE id = $2`,
      [refundPoints, userId],
    );

    // registeredCount 감소
    await client.query(
      `UPDATE public.events
       SET registered_count = GREATEST(registered_count - 1, 0), updated_at = NOW()
       WHERE id = $1`,
      [eventId],
    );

    await client.query("COMMIT");
    return mapRegistration(reg);
  } catch (err) {
    // ROLLBACK 이 이미 위에서 실행된 경우 두 번째 롤백 시도는 실패할 수 있으나
    // pg 는 무해하게 처리. 미처 롤백 못 한 경로(예: 후속 UPDATE 실패)를 커버.
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 7. 내 신청 목록
 */
async function listMyRegistrations(
  userId: number,
  params: { status?: string; page: number; limit: number },
): Promise<{ data: (EventRegistrationRow & { event: Partial<EventRow> })[]; totalCount: number }> {
  const { status, page, limit } = params;
  const offset = (page - 1) * limit;

  const conditions = ["er.user_id = $1"];
  const values: unknown[] = [userId];
  let idx = 2;

  if (status) {
    conditions.push(`er.status = $${idx++}`);
    values.push(status);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM public.event_registrations er ${where}`,
    values,
  );
  const totalCount = parseInt(countRes.rows[0].count, 10);

  const dataRes = await pool.query(
    `SELECT
       er.*,
       e.id AS ev_id, e.title AS ev_title, e.category AS ev_category,
       e.opens_at AS ev_opens_at, e.status AS ev_status, e.poster_color AS ev_poster_color,
       e.poster_initial AS ev_poster_initial, e.prize AS ev_prize
     FROM public.event_registrations er
     JOIN public.events e ON e.id = er.event_id
     ${where}
     ORDER BY er.registered_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, limit, offset],
  );

  const data = dataRes.rows.map((row) => ({
    ...mapRegistration(row),
    event: {
      eventId:      row.ev_id as number,
      title:        row.ev_title as string,
      category:     row.ev_category as string,
      opensAt:      new Date(row.ev_opens_at as Date).toISOString(),
      status:       row.ev_status as string,
      posterColor:  row.ev_poster_color as string,
      posterInitial: row.ev_poster_initial as string,
      prize:        row.ev_prize as string,
    },
  }));

  return { data, totalCount };
}

// ─── 랭킹 서비스 ─────────────────────────────────────────────────────────────

export interface EventRankingRow {
  rank: number;
  nickname: string;
  seatLabel: string;
  elapsedMs: number;
  ticketedAt: string;
}

/**
 * 마지막으로 진행된(closed) 이벤트 하나의 참여자 랭킹.
 * closes_at DESC 로 가장 최근 종료 이벤트를 찾아 tickets 를 rank ASC 정렬해 반환.
 * 종료된 이벤트가 없으면 event=null, rankings=[] 반환.
 *
 * `tickets.event_id IS NOT NULL AND round_id IS NULL` 조건으로 라이브 라운드
 * 티켓과 이벤트 티켓을 구분한다 (라이브 티켓은 round_id 를 가짐).
 */
async function getLatestClosedEventRankings(
  limit: number,
): Promise<{
  event: EventRow | null;
  rankings: EventRankingRow[];
}> {
  const evRes = await pool.query(
    `SELECT ${EVENT_SELECT}
     FROM public.events e
     JOIN public.venues v ON v.id = e.venue_id
     WHERE e.status = 'closed'
       AND e.hidden_at IS NULL
     ORDER BY e.closes_at DESC
     LIMIT 1`,
  );

  if (evRes.rows.length === 0) {
    return { event: null, rankings: [] };
  }

  const event = mapEvent(evRes.rows[0]);

  const ticketsRes = await pool.query(
    `SELECT rank, passenger_nickname, seat_label, elapsed_ms, issued_at
     FROM public.tickets
     WHERE event_id = $1 AND round_id IS NULL
     ORDER BY rank ASC
     LIMIT $2`,
    [event.eventId, limit],
  );

  const rankings: EventRankingRow[] = ticketsRes.rows.map((r) => ({
    rank:       r.rank as number,
    nickname:   r.passenger_nickname as string,
    seatLabel:  r.seat_label as string,
    elapsedMs:  r.elapsed_ms as number,
    ticketedAt: (r.issued_at as Date).toISOString(),
  }));

  return { event, rankings };
}

// ─── 티켓팅 세션 서비스 ──────────────────────────────────────────────────────

/**
 * 이벤트 세션 시작 결과 타입
 */
export interface StartEventSessionResult {
  sessionId: string;
  registrationId: number;
  eventId: number;
  status: "active" | "queued";
  queuePosition: number | null;
  startedAt: string;
}

/**
 * 8. 이벤트 세션 시작
 *
 * - pending 신청자만 허용 (NOT_REGISTERED 403)
 * - event.status = 'open' 이어야 함 (EVENT_NOT_OPEN 409)
 * - closes_at > now 이중 방어 체크 (스케줄러 미구현 대비)
 * - 신청 상태: pending → entered
 * - live_sessions 레코드 생성 후 sessionId 반환
 * - 좌석은 FE 소유: 사전 생성하지 않음. holdSeat 시점에 upsert
 * - active/queued 분기: 정원(config.live.activeCapacity) 기준
 * - 이미 세션이 있으면 기존 세션 반환 (중복 입장 방지)
 */
async function startEventSession(
  eventId: number,
  userId: number,
): Promise<StartEventSessionResult> {
  // 이벤트 조회
  const eventRes = await pool.query(
    `SELECT e.id, e.status, e.closes_at, e.venue_id, e.total_seats,
            u.name AS user_name
     FROM public.events e
     JOIN public.users u ON u.id = $2
     WHERE e.id = $1`,
    [eventId, userId],
  );
  if (eventRes.rows.length === 0) {
    throw makeError("EVENT_NOT_FOUND", 404, "이벤트를 찾을 수 없습니다.");
  }
  const event = eventRes.rows[0];

  // 스케줄러 미구현 대비 이중 방어 시각 체크
  if (new Date(event.closes_at) <= new Date()) {
    throw makeError("EVENT_NOT_OPEN", 409, "이미 종료된 이벤트입니다.");
  }
  if (event.status !== "open") {
    throw makeError("EVENT_NOT_OPEN", 409, "티켓팅 오픈 상태가 아닙니다.");
  }

  // 신청 확인 (pending 또는 entered — entered는 기존 세션이 있을 수 있음)
  const regRes = await pool.query(
    `SELECT id, status FROM public.event_registrations
     WHERE event_id = $1 AND user_id = $2
       AND status IN ('pending', 'entered')`,
    [eventId, userId],
  );
  if (regRes.rows.length === 0) {
    throw makeError("NOT_REGISTERED", 403, "사전 신청자만 세션을 시작할 수 있습니다.");
  }
  const registration = regRes.rows[0];
  const registrationId: number = registration.id;

  // 기존 세션 조회 (중복 입장 방지)
  const existingSession = await pool.query(
    `SELECT session_id, status, queue_position, started_at
     FROM public.live_sessions
     WHERE event_id = $1 AND user_id = $2
       AND status IN ('queued', 'active', 'completed')`,
    [eventId, userId],
  );
  if (existingSession.rows.length > 0) {
    const row = existingSession.rows[0];
    return {
      sessionId:      row.session_id,
      registrationId,
      eventId,
      status:         row.status as "active" | "queued",
      queuePosition:  row.queue_position ?? null,
      startedAt:      new Date(row.started_at).toISOString(),
    };
  }

  // 좌석 사전 생성 없음: 좌석 카탈로그는 FE 소유. holdSeat 시점에 upsert.

  // pending → entered 상태 전환 (이미 entered면 무시)
  if (registration.status === "pending") {
    await pool.query(
      `UPDATE public.event_registrations SET status = 'entered' WHERE id = $1`,
      [registrationId],
    );
  }

  // sessionId 생성 (20자 hex)
  const sessionId = crypto.randomBytes(10).toString("hex");
  const nickname: string = event.user_name;
  const activeCapacity = config.live.activeCapacity;

  // active INSERT 시도: 정원 여유가 있을 때만 성공 (원자적 조건부 INSERT)
  const activeResult = await pool.query(
    `INSERT INTO public.live_sessions
       (session_id, event_id, user_id, nickname, status, started_at)
     SELECT $1, $2, $3, $4, 'active', NOW()
     WHERE (
       SELECT COUNT(*) FROM public.live_sessions
       WHERE event_id = $2 AND status = 'active'
     ) < $5
     RETURNING session_id, status, queue_position, started_at`,
    [sessionId, eventId, userId, nickname, activeCapacity],
  );

  if ((activeResult.rowCount ?? 0) > 0) {
    const inserted = activeResult.rows[0];
    return {
      sessionId:      inserted.session_id,
      registrationId,
      eventId,
      status:         "active",
      queuePosition:  null,
      startedAt:      new Date(inserted.started_at).toISOString(),
    };
  }

  // 정원 초과 → queued INSERT
  const queuedResult = await pool.query(
    `INSERT INTO public.live_sessions
       (session_id, event_id, user_id, nickname, status, queue_position, started_at)
     VALUES ($1, $2, $3, $4, 'queued',
       (SELECT COALESCE(MAX(queue_position), 0) + 1
        FROM public.live_sessions
        WHERE event_id = $2 AND status = 'queued'),
       NOW())
     RETURNING session_id, status, queue_position, started_at`,
    [sessionId, eventId, userId, nickname],
  );

  const queued = queuedResult.rows[0];
  return {
    sessionId:      queued.session_id,
    registrationId,
    eventId,
    status:         "queued",
    queuePosition:  queued.queue_position ?? null,
    startedAt:      new Date(queued.started_at).toISOString(),
  };
}

// ─── 관리자 서비스 ───────────────────────────────────────────────────────────

/**
 * 9. 공연장 목록
 * venueId = slug 문자열로 반환
 */
async function listVenues(): Promise<VenueRow[]> {
  const res = await pool.query(
    `SELECT slug AS "venueId", name, layout, total_seats AS "totalSeats", thumbnail_url AS "thumbnailUrl"
     FROM public.venues
     ORDER BY name ASC`,
  );
  return res.rows;
}

/**
 * 10. 단발 이벤트 생성 (관리자)
 * venueId = slug 문자열로 받아 내부적으로 정수 PK 조회
 */
async function createEvent(
  params: {
    type?: string;
    title: string;
    category: string;
    venueId: string;  // slug 문자열
    opensAt: string;
    durationMs?: number;
    entryFeePoints?: number;
    prize: string;
    posterColor: string;
    posterInitial?: string;
  },
  createdBy: number,
): Promise<EventRow> {
  const {
    title, category, venueId,
    opensAt, prize, posterColor,
  } = params;
  const durationMs     = params.durationMs     ?? 300000;
  const entryFeePoints = params.entryFeePoints ?? 500;
  const posterInitial  = params.posterInitial  ?? "";

  const now = new Date();
  const opensAtDate = new Date(opensAt);

  // opensAt >= now + 5분
  if (opensAtDate.getTime() < now.getTime() + 5 * 60 * 1000) {
    throw makeError("VALIDATION_ERROR", 400, "opensAt은 현재 시각 기준 최소 5분 후여야 합니다.");
  }
  // opensAt <= now + 1년
  if (opensAtDate.getTime() > now.getTime() + 365 * 24 * 60 * 60 * 1000) {
    throw makeError("VALIDATION_ERROR", 400, "opensAt은 1년 이내여야 합니다.");
  }

  // 공연장 slug → 정수 PK 조회 + totalSeats 가져오기
  const venueRes = await pool.query(
    `SELECT id, total_seats FROM public.venues WHERE slug = $1`,
    [venueId],
  );
  if (venueRes.rows.length === 0) {
    throw makeError("VENUE_NOT_FOUND", 404, "공연장을 찾을 수 없습니다.");
  }
  const venueIntId: number = venueRes.rows[0].id;
  const totalSeats: number = venueRes.rows[0].total_seats;

  const closesAt = new Date(opensAtDate.getTime() + durationMs);
  const registrationDeadline = calcRegistrationDeadline(opensAt);

  // 같은 venue 시간 충돌 검사
  const conflictRes = await pool.query(
    `SELECT id FROM public.events
     WHERE venue_id = $1
       AND status NOT IN ('cancelled')
       AND opens_at < $2
       AND closes_at > $3`,
    [venueIntId, closesAt.toISOString(), opensAtDate.toISOString()],
  );
  if (conflictRes.rows.length > 0) {
    throw makeError("EVENT_TIME_CONFLICT", 409, "같은 공연장에 시간이 겹치는 이벤트가 있습니다.");
  }

  const insertRes = await pool.query(
    `INSERT INTO public.events
       (type, title, category, venue_id, total_seats, opens_at, closes_at,
        duration_ms, entry_fee_points, registration_deadline, prize,
        poster_color, poster_initial, status, created_by)
     VALUES ('paid', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'scheduled', $13)
     RETURNING *`,
    [
      title, category, venueIntId, totalSeats,
      opensAtDate.toISOString(), closesAt.toISOString(),
      durationMs, entryFeePoints, registrationDeadline.toISOString(),
      prize, posterColor, posterInitial, createdBy,
    ],
  );

  // venue_name JOIN 후 반환
  const fullRes = await pool.query(
    `SELECT ${EVENT_SELECT}
     FROM public.events e
     JOIN public.venues v ON v.id = e.venue_id
     WHERE e.id = $1`,
    [insertRes.rows[0].id],
  );
  const created = mapEvent(fullRes.rows[0]);
  // 스케줄러에 open/close 타이머 등록 (setTimeout 기반, 정확한 시각 발화)
  scheduleEvent(created.eventId, new Date(created.opensAt), new Date(created.closesAt));
  return created;
}

/**
 * 11. 반복 시리즈 생성 (관리자)
 */
async function createEventSeries(
  params: {
    title: string;
    category: string;
    venueId: string;  // slug 문자열
    durationMs?: number;
    entryFeePoints?: number;
    prize: string;
    posterColor: string;
    posterInitial?: string;
    recurrence: {
      kind: "daily" | "weekly" | "monthly";
      weekdays?: number[];
      startAt: string;
    };
  },
  createdBy: number,
): Promise<{ series: Record<string, unknown>; createdEvents: EventRow[] }> {
  const {
    title, category, venueId, prize, posterColor,
  } = params;
  const durationMs     = params.durationMs     ?? 300000;
  const entryFeePoints = params.entryFeePoints ?? 500;
  const posterInitial  = params.posterInitial  ?? "";
  const { kind, weekdays, startAt } = params.recurrence;

  // weekly 검증
  if (kind === "weekly" && (!weekdays || weekdays.length === 0)) {
    throw makeError("RECURRENCE_INVALID", 400, "weekly 반복에는 weekdays가 필수입니다.");
  }

  // 공연장 slug → 정수 PK 조회
  const venueRes = await pool.query(
    `SELECT id, total_seats FROM public.venues WHERE slug = $1`,
    [venueId],
  );
  if (venueRes.rows.length === 0) {
    throw makeError("VENUE_NOT_FOUND", 404, "공연장을 찾을 수 없습니다.");
  }
  const venueIntId: number = venueRes.rows[0].id;
  const totalSeats: number = venueRes.rows[0].total_seats;

  // startAt이 속한 달의 KST 말일 23:59:59 계산
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const startAtDate = new Date(startAt);
  const startAtKstMs = startAtDate.getTime() + KST_OFFSET_MS;
  const kstDate = new Date(startAtKstMs);
  const kstYear  = kstDate.getUTCFullYear();
  const kstMonth = kstDate.getUTCMonth(); // 0-indexed
  // 말일 23:59:59 KST = UTC
  const monthEndKst = new Date(Date.UTC(kstYear, kstMonth + 1, 0, 23, 59, 59) - KST_OFFSET_MS);

  // 인스턴스 opensAt 목록 생성 (최대 31개)
  const instanceDates: Date[] = [];
  const MAX_INSTANCES = 31;

  let cursor = startAtDate;
  while (cursor <= monthEndKst && instanceDates.length < MAX_INSTANCES) {
    // KST 기준 요일 확인
    const cursorKst = new Date(cursor.getTime() + KST_OFFSET_MS);
    const kstDay = cursorKst.getUTCDay(); // 0=일 ~ 6=토

    let include = false;
    if (kind === "daily") {
      include = true;
    } else if (kind === "weekly") {
      include = (weekdays ?? []).includes(kstDay);
    } else if (kind === "monthly") {
      // monthly: startAt과 같은 일(day)
      const startKst = new Date(startAtDate.getTime() + KST_OFFSET_MS);
      include = cursorKst.getUTCDate() === startKst.getUTCDate();
    }

    if (include) {
      instanceDates.push(new Date(cursor));
    }

    // 다음 날로 이동
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  if (instanceDates.length === 0) {
    throw makeError("RECURRENCE_INVALID", 400, "생성할 이벤트 인스턴스가 없습니다.");
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    // 시리즈 레코드 생성
    const recurrenceJson = {
      kind,
      weekdays: weekdays ?? null,
      startAt,
      monthEndAt: monthEndKst.toISOString(),
    };

    const seriesInsert = await client.query(
      `INSERT INTO public.event_series
         (title, category, venue_id, duration_ms, entry_fee_points,
          prize, poster_color, poster_initial, recurrence, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        title, category, venueIntId, durationMs, entryFeePoints,
        prize, posterColor, posterInitial,
        JSON.stringify(recurrenceJson), createdBy,
      ],
    );
    const series = seriesInsert.rows[0];

    // 각 인스턴스 생성 (시간 충돌 검사 포함)
    const createdEventIds: number[] = [];
    for (const opensAtDate of instanceDates) {
      const closesAt = new Date(opensAtDate.getTime() + durationMs);
      const registrationDeadline = calcRegistrationDeadline(opensAtDate.toISOString());

      // 충돌 검사
      const conflictRes = await client.query(
        `SELECT id FROM public.events
         WHERE venue_id = $1
           AND status NOT IN ('cancelled')
           AND opens_at < $2
           AND closes_at > $3`,
        [venueIntId, closesAt.toISOString(), opensAtDate.toISOString()],
      );
      if (conflictRes.rows.length > 0) {
        await client.query("ROLLBACK");
        throw makeError(
          "EVENT_TIME_CONFLICT",
          409,
          `${opensAtDate.toISOString()} 시각에 같은 공연장 이벤트와 시간이 겹칩니다.`,
        );
      }

      const evInsert = await client.query(
        `INSERT INTO public.events
           (type, title, category, venue_id, total_seats, opens_at, closes_at,
            duration_ms, entry_fee_points, registration_deadline, prize,
            poster_color, poster_initial, status, series_id, created_by)
         VALUES ('paid', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'scheduled', $13, $14)
         RETURNING id`,
        [
          title, category, venueIntId, totalSeats,
          opensAtDate.toISOString(), closesAt.toISOString(),
          durationMs, entryFeePoints, registrationDeadline.toISOString(),
          prize, posterColor, posterInitial, series.id, createdBy,
        ],
      );
      createdEventIds.push(evInsert.rows[0].id);
    }

    await client.query("COMMIT");

    // 생성된 이벤트 전체 조회
    const eventsRes = await pool.query(
      `SELECT ${EVENT_SELECT}
       FROM public.events e
       JOIN public.venues v ON v.id = e.venue_id
       WHERE e.id = ANY($1)
       ORDER BY e.opens_at ASC`,
      [createdEventIds],
    );

    const createdEvents = eventsRes.rows.map(mapEvent);
    // 각 인스턴스별 스케줄러 등록
    for (const ev of createdEvents) {
      scheduleEvent(ev.eventId, new Date(ev.opensAt), new Date(ev.closesAt));
    }

    return {
      series: {
        seriesId:       series.id,
        title:          series.title,
        category:       series.category,
        venueId:        venueId,    // slug 문자열 반환
        durationMs:     series.duration_ms,
        entryFeePoints: series.entry_fee_points,
        prize:          series.prize,
        posterColor:    series.poster_color,
        posterInitial:  series.poster_initial,
        recurrence:     series.recurrence,
        createdBy:      series.created_by,
        createdAt:      new Date(series.created_at).toISOString(),
        updatedAt:      new Date(series.updated_at).toISOString(),
      },
      createdEvents,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 12. 관리자 이벤트 목록 (cancelled 포함)
 */
async function adminListEvents(params: {
  status?: string;
  category?: string;
  from?: string;
  to?: string;
  includeHidden?: boolean;
  page: number;
  limit: number;
}): Promise<{ data: EventRow[]; totalCount: number }> {
  const { status, category, from, to, includeHidden = true, page, limit } = params;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  // 관리자 기본 = 전체 노출. includeHidden=false 명시 시에만 hidden 제외.
  if (!includeHidden) {
    conditions.push(`e.hidden_at IS NULL`);
  }

  if (status) {
    conditions.push(`e.status = $${idx++}`);
    values.push(status);
  }
  if (category) {
    conditions.push(`e.category = $${idx++}`);
    values.push(category);
  }
  if (from) {
    conditions.push(`e.opens_at >= $${idx++}`);
    values.push(from);
  }
  if (to) {
    conditions.push(`e.opens_at <= $${idx++}`);
    values.push(to);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM public.events e ${where}`,
    values,
  );
  const totalCount = parseInt(countRes.rows[0].count, 10);

  const dataRes = await pool.query(
    `SELECT ${EVENT_SELECT}
     FROM public.events e
     JOIN public.venues v ON v.id = e.venue_id
     ${where}
     ORDER BY e.opens_at ASC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, limit, offset],
  );

  return { data: dataRes.rows.map(mapEvent), totalCount };
}

/**
 * 13. 이벤트 단건 수정 (관리자)
 */
async function updateEvent(
  eventId: number,
  fields: {
    title?: string;
    category?: string;
    venueId?: string;  // slug 문자열
    opensAt?: string;
    durationMs?: number;
    entryFeePoints?: number;
    prize?: string;
    posterColor?: string;
    posterInitial?: string;
  },
): Promise<EventRow> {
  const eventRes = await pool.query(
    `SELECT * FROM public.events WHERE id = $1`,
    [eventId],
  );
  if (eventRes.rows.length === 0) {
    throw makeError("EVENT_NOT_FOUND", 404, "이벤트를 찾을 수 없습니다.");
  }
  const event = eventRes.rows[0];

  if (event.status === "closed") {
    throw makeError("EVENT_ALREADY_CLOSED", 409, "종료된 이벤트는 수정할 수 없습니다.");
  }
  if (event.status === "cancelled") {
    throw makeError("EVENT_CANCEL_FORBIDDEN", 409, "취소된 이벤트는 수정할 수 없습니다.");
  }

  // open 상태에서는 제한된 필드만 허용
  if (event.status === "open") {
    const OPEN_ALLOWED = ["title", "posterColor", "posterInitial", "prize"];
    const disallowed = Object.keys(fields).filter((k) => !OPEN_ALLOWED.includes(k));
    if (disallowed.length > 0) {
      throw makeError(
        "EVENT_ALREADY_STARTED",
        409,
        `오픈 상태에서는 ${OPEN_ALLOWED.join(", ")} 만 수정 가능합니다.`,
      );
    }
  }

  // 공연장 변경 시 slug → 정수 PK 조회 + totalSeats 재계산
  let totalSeats = event.total_seats;
  let newVenueIntId: number | undefined;
  if (fields.venueId) {
    const venueRes = await pool.query(
      `SELECT id, total_seats FROM public.venues WHERE slug = $1`,
      [fields.venueId],
    );
    if (venueRes.rows.length === 0) {
      throw makeError("VENUE_NOT_FOUND", 404, "공연장을 찾을 수 없습니다.");
    }
    // 실제로 venue가 변경되는 경우만 totalSeats 갱신
    if (venueRes.rows[0].id !== event.venue_id) {
      totalSeats = venueRes.rows[0].total_seats;
    }
    newVenueIntId = venueRes.rows[0].id;
  }

  // opensAt 변경 시 재계산
  let newOpensAt     = event.opens_at;
  let newClosesAt    = event.closes_at;
  let newRegDeadline = event.registration_deadline;
  const newDurationMs = fields.durationMs ?? event.duration_ms;

  if (fields.opensAt) {
    const newOpensAtDate = new Date(fields.opensAt);
    const nowForUpdate = new Date();

    // opensAt >= now + 5분
    if (newOpensAtDate.getTime() < nowForUpdate.getTime() + 5 * 60 * 1000) {
      throw makeError("VALIDATION_ERROR", 400, "opensAt은 현재 시각 기준 최소 5분 후여야 합니다.");
    }
    // opensAt <= now + 1년
    if (newOpensAtDate.getTime() > nowForUpdate.getTime() + 365 * 24 * 60 * 60 * 1000) {
      throw makeError("VALIDATION_ERROR", 400, "opensAt은 1년 이내여야 합니다.");
    }

    newOpensAt = newOpensAtDate;
    newClosesAt = new Date(newOpensAtDate.getTime() + newDurationMs);
    newRegDeadline = calcRegistrationDeadline(fields.opensAt);

    // 시간 충돌 검사 (정수 PK 사용)
    const conflictRes = await pool.query(
      `SELECT id FROM public.events
       WHERE venue_id = $1
         AND id != $2
         AND status NOT IN ('cancelled')
         AND opens_at < $3
         AND closes_at > $4`,
      [newVenueIntId ?? event.venue_id, eventId, newClosesAt.toISOString(), newOpensAt.toISOString()],
    );
    if (conflictRes.rows.length > 0) {
      throw makeError("EVENT_TIME_CONFLICT", 409, "같은 공연장에 시간이 겹치는 이벤트가 있습니다.");
    }
  } else if (fields.durationMs) {
    // durationMs만 바뀌는 경우도 closesAt 재계산
    newClosesAt = new Date(new Date(event.opens_at).getTime() + fields.durationMs);
  }

  // 동적 SET 절 구성
  // venueId(slug)는 정수 PK로 변환된 newVenueIntId를 직접 처리 (fieldMap에서 제외)
  const setClauses: string[] = ["updated_at = NOW()"];
  const values: unknown[] = [];
  let idx = 1;

  const fieldMap: Record<string, string> = {
    title:          "title",
    category:       "category",
    prize:          "prize",
    posterColor:    "poster_color",
    posterInitial:  "poster_initial",
    entryFeePoints: "entry_fee_points",
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    const val = (fields as Record<string, unknown>)[key];
    if (val !== undefined) {
      setClauses.push(`${col} = $${idx++}`);
      values.push(val);
    }
  }

  // venue_id: slug에서 변환된 정수 PK 사용
  if (newVenueIntId !== undefined) {
    setClauses.push(`venue_id = $${idx++}`);
    values.push(newVenueIntId);
    setClauses.push(`total_seats = $${idx++}`);
    values.push(totalSeats);
  }

  if (fields.opensAt) {
    setClauses.push(`opens_at = $${idx++}`, `closes_at = $${idx++}`, `registration_deadline = $${idx++}`, `duration_ms = $${idx++}`);
    values.push(newOpensAt, newClosesAt, newRegDeadline, newDurationMs);
  } else if (fields.durationMs) {
    setClauses.push(`closes_at = $${idx++}`, `duration_ms = $${idx++}`);
    values.push(newClosesAt, fields.durationMs);
  }

  values.push(eventId);

  await pool.query(
    `UPDATE public.events SET ${setClauses.join(", ")} WHERE id = $${idx}`,
    values,
  );

  const fullRes = await pool.query(
    `SELECT ${EVENT_SELECT}
     FROM public.events e
     JOIN public.venues v ON v.id = e.venue_id
     WHERE e.id = $1`,
    [eventId],
  );
  const updated = mapEvent(fullRes.rows[0]);
  // opens_at/closes_at 이 바뀌었을 수 있으므로 스케줄러 재등록.
  // 변경 없어도 재등록은 무해 (기존 타이머 취소 후 동일 시각으로 재등록).
  scheduleEvent(updated.eventId, new Date(updated.opensAt), new Date(updated.closesAt));
  return updated;
}

/**
 * 단일 이벤트 취소 내부 헬퍼 (client 인자를 받아 트랜잭션 재사용 가능)
 *
 * - 이미 cancelled/closed 상태인 이벤트는 건너뜀 (시리즈 일괄 취소 시 부분 생략)
 * - 호출자가 BEGIN/COMMIT/ROLLBACK 을 관리한다
 */
async function cancelEventWithClient(
  client: PoolClient,
  eventId: number,
  reason: string,
): Promise<void> {
  const eventRes = await client.query(
    `SELECT id, status FROM public.events WHERE id = $1 FOR UPDATE`,
    [eventId],
  );
  if (eventRes.rows.length === 0) return; // 시리즈 취소에서는 무시

  const event = eventRes.rows[0];
  if (event.status === "cancelled" || event.status === "closed") return;

  // 이벤트 상태 cancelled 처리
  await client.query(
    `UPDATE public.events
     SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $1, updated_at = NOW()
     WHERE id = $2`,
    [reason, eventId],
  );

  // pending 신청자 전원 환불
  const pendingRes = await client.query(
    `SELECT id, user_id, points_paid
     FROM public.event_registrations
     WHERE event_id = $1 AND status = 'pending'`,
    [eventId],
  );

  for (const reg of pendingRes.rows) {
    await client.query(
      `UPDATE public.event_registrations
       SET status = 'refunded', refunded_at = NOW(), refund_points = $1
       WHERE id = $2`,
      [reg.points_paid, reg.id],
    );
    await client.query(
      `UPDATE public.users SET points = points + $1 WHERE id = $2`,
      [reg.points_paid, reg.user_id],
    );
  }
}

/**
 * 14. 이벤트 취소 (관리자) + 전 신청자 자동 환불
 */
async function cancelEvent(
  eventId: number,
  reason: string,
): Promise<EventRow> {
  // 취소 전 상태 검증 (트랜잭션 밖 빠른 사전 확인)
  const preCheckRes = await pool.query(
    `SELECT status FROM public.events WHERE id = $1`,
    [eventId],
  );
  if (preCheckRes.rows.length === 0) {
    throw makeError("EVENT_NOT_FOUND", 404, "이벤트를 찾을 수 없습니다.");
  }
  const preStatus = preCheckRes.rows[0].status;
  if (preStatus === "cancelled") {
    throw makeError("EVENT_CANCEL_FORBIDDEN", 409, "이미 취소된 이벤트입니다.");
  }
  if (preStatus === "closed") {
    throw makeError("EVENT_ALREADY_CLOSED", 409, "종료된 이벤트는 취소할 수 없습니다.");
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await cancelEventWithClient(client, eventId, reason);
    await client.query("COMMIT");

    // 스케줄된 open/close 타이머 취소 (커밋 후에만 실행해 롤백 시 스케줄이
    // 남아있도록 함)
    cancelScheduledEvent(eventId);

    const fullRes = await pool.query(
      `SELECT ${EVENT_SELECT}
       FROM public.events e
       JOIN public.venues v ON v.id = e.venue_id
       WHERE e.id = $1`,
      [eventId],
    );
    return mapEvent(fullRes.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 15. 시리즈 전체(또는 from 이후) 취소 (관리자)
 *
 * 단일 트랜잭션으로 처리: 중간 실패 시 전체 롤백한다.
 */
async function cancelSeries(
  seriesId: number,
  from?: string,
): Promise<void> {
  const seriesRes = await pool.query(
    `SELECT id FROM public.event_series WHERE id = $1`,
    [seriesId],
  );
  if (seriesRes.rows.length === 0) {
    throw makeError("EVENT_NOT_FOUND", 404, "시리즈를 찾을 수 없습니다.");
  }

  // 취소 대상 이벤트 조회
  const conditions = [
    `series_id = $1`,
    `status NOT IN ('cancelled', 'closed')`,
  ];
  const queryValues: unknown[] = [seriesId];

  if (from) {
    conditions.push(`opens_at >= $2`);
    queryValues.push(from);
  }

  const eventsRes = await pool.query(
    `SELECT id FROM public.events WHERE ${conditions.join(" AND ")}`,
    queryValues,
  );

  if (eventsRes.rows.length === 0) return;

  // 단일 트랜잭션으로 모든 이벤트 취소
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of eventsRes.rows) {
      await cancelEventWithClient(client, row.id, `시리즈(${seriesId}) 일괄 취소`);
    }
    await client.query("COMMIT");

    // 커밋 성공 후 각 이벤트 스케줄 취소
    for (const row of eventsRes.rows) {
      cancelScheduledEvent(row.id);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 16. 관리자 신청자 목록
 */
async function adminListRegistrations(
  eventId: number,
  params: { status?: string; page: number; limit: number },
): Promise<{
  data: (EventRegistrationRow & { user: { id: number; name: string; email: string } })[];
  totalCount: number;
}> {
  const { status, page, limit } = params;
  const offset = (page - 1) * limit;

  const conditions = [`er.event_id = $1`];
  const values: unknown[] = [eventId];
  let idx = 2;

  if (status) {
    conditions.push(`er.status = $${idx++}`);
    values.push(status);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM public.event_registrations er ${where}`,
    values,
  );
  const totalCount = parseInt(countRes.rows[0].count, 10);

  const dataRes = await pool.query(
    `SELECT er.*, u.id AS u_id, u.name AS u_name, u.email AS u_email
     FROM public.event_registrations er
     JOIN public.users u ON u.id = er.user_id
     ${where}
     ORDER BY er.registered_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, limit, offset],
  );

  const data = dataRes.rows.map((row) => ({
    ...mapRegistration(row),
    user: {
      id:    row.u_id as number,
      name:  row.u_name as string,
      email: row.u_email as string,
    },
  }));

  return { data, totalCount };
}

// ─── 관리자 통계 서비스 ─────────────────────────────────────────────────────

export interface EventStatsRow {
  eventId: number;
  status: string;
  registered: number;
  ticketed: number;
  noShow: number;
  netRevenue: number;
}

/**
 * 관리자 이벤트 통계 (결과 집계 전용).
 *
 * 필드:
 *   registered — 유효 신청 수. cancelled/refunded 제외.
 *   ticketed   — 좌석 잡기 성공한 사람.
 *   noShow     — 세션 시작했지만 좌석 못 잡음.
 *   netRevenue — 걷은 포인트 - 환불 포인트.
 *
 * 실시간 진행 지표(activeSessions, queuedSessions 등)는 이 API 범위 밖.
 * 필요 시 별도 엔드포인트로 분리.
 */
async function getEventStats(eventId: number): Promise<EventStatsRow> {
  const evRes = await pool.query(
    `SELECT id, status FROM public.events WHERE id = $1`,
    [eventId],
  );
  if (evRes.rows.length === 0) {
    throw makeError("EVENT_NOT_FOUND", 404, "이벤트를 찾을 수 없습니다.");
  }

  const statsRes = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('pending','entered','ticketed','no_show','missed'))
         AS registered,
       COUNT(*) FILTER (WHERE status = 'ticketed') AS ticketed,
       COUNT(*) FILTER (WHERE status = 'no_show')  AS no_show,
       COALESCE(SUM(points_paid)   FILTER (WHERE status IN ('pending','entered','ticketed','no_show','missed')), 0)
         AS collected,
       COALESCE(SUM(refund_points) FILTER (WHERE status IN ('cancelled','refunded')), 0)
         AS refunded
     FROM public.event_registrations
     WHERE event_id = $1`,
    [eventId],
  );
  const row = statsRes.rows[0];

  return {
    eventId,
    status:     evRes.rows[0].status as string,
    registered: parseInt(row.registered, 10),
    ticketed:   parseInt(row.ticketed,   10),
    noShow:     parseInt(row.no_show,    10),
    netRevenue: parseInt(row.collected,  10) - parseInt(row.refunded, 10),
  };
}

export {
  listEvents,
  getCalendar,
  getNearestEvent,
  getEventById,
  registerEvent,
  cancelMyRegistration,
  listMyRegistrations,
  startEventSession,
  listVenues,
  getLatestClosedEventRankings,
  createEvent,
  createEventSeries,
  adminListEvents,
  updateEvent,
  cancelEvent,
  cancelSeries,
  adminListRegistrations,
  getEventStats,
};
