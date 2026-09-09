import pool from "../config/db";

/**
 * ─── 이벤트 상태 자동 전이 스케줄러 ─────────────────────────────────────────
 *
 * 라이브와 달리 이벤트는 관리자가 임의 시각(예: 26일 17:03)으로 opens_at 을
 * 지정하기 때문에 크론 표현식으로 정확한 시각 발화가 불가능하다. 정확도를 위해
 * setTimeout 기반 개별 예약 방식을 사용한다.
 *
 * 동작:
 *   - createEvent/createEventSeries 성공 시 → scheduleEvent 로 open/close 타이머 등록
 *   - updateEvent 로 opens_at 변경 시 → 기존 타이머 취소 후 재등록
 *   - cancelEvent(WithClient) 시 → 타이머 취소
 *   - 서버 부팅 시 → bootstrapEventSchedules 로 미래 이벤트 전체 재예약,
 *                      과거 시각(놓친 발화)은 즉시 실행하며 백필
 *
 * 프로세스 메모리에만 저장되므로 서버 재시작 시 코드가 다시 재등록해야 한다.
 */

interface EventTimers {
  openTimer: NodeJS.Timeout | null;
  closeTimer: NodeJS.Timeout | null;
}

const scheduledTimers = new Map<number, EventTimers>();

// Node setTimeout 은 최대 값이 2^31-1 ms (약 24.85일). 초과 시 즉시 실행되므로
// 재귀적으로 분할 등록해 아주 먼 미래(수개월~1년) 이벤트도 안전하게 처리한다.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** 지정 시각까지 지연 후 콜백 실행. MAX_TIMEOUT_MS 초과 시 재귀 분할. */
function longSetTimeout(callback: () => void, delayMs: number): NodeJS.Timeout {
  if (delayMs <= MAX_TIMEOUT_MS) {
    return setTimeout(callback, delayMs);
  }
  // 최대치만큼 대기 후 남은 시간 재예약. 반환된 timer 는 최상위 timer 로 유지.
  const timer: { current: NodeJS.Timeout } = { current: null as unknown as NodeJS.Timeout };
  timer.current = setTimeout(() => {
    timer.current = longSetTimeout(callback, delayMs - MAX_TIMEOUT_MS);
  }, MAX_TIMEOUT_MS);
  return timer.current;
}

// ─── 상태 전이 실제 로직 ─────────────────────────────────────────────────────

/**
 * scheduled → open 전이. opens_at 도달 시 호출.
 * 이벤트가 이미 다른 상태(cancelled/closed/open)면 조건부 UPDATE 로 무시.
 */
async function transitionToOpen(eventId: number): Promise<void> {
  try {
    const res = await pool.query(
      `UPDATE public.events
       SET status = 'open', updated_at = NOW()
       WHERE id = $1 AND status = 'scheduled'
       RETURNING id`,
      [eventId],
    );
    if ((res.rowCount ?? 0) > 0) {
      console.log(`[event/scheduler] event ${eventId} → open`);
    }
  } catch (err) {
    console.error(`[event/scheduler] transitionToOpen(${eventId}) failed:`, err);
  }
}

/**
 * scheduled/open → closed 전이 + registration 상태 일괄 정리.
 *
 * registration 상태 규칙:
 *   - pending  (신청만 하고 세션 미시작) → missed
 *   - entered  + 완주한 live_sessions 존재 → ticketed
 *   - entered  + 티켓 없음                          → no_show
 *
 * 트랜잭션으로 원자화. 이벤트 상태 변경이 실패하면(이미 다른 상태) 아무 것도
 * 하지 않는다.
 */
async function transitionToClosed(eventId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const evRes = await client.query(
      `UPDATE public.events
       SET status = 'closed', updated_at = NOW()
       WHERE id = $1 AND status IN ('scheduled', 'open')
       RETURNING id`,
      [eventId],
    );
    if ((evRes.rowCount ?? 0) === 0) {
      // 이미 cancelled/closed. 별도 처리 없이 종료.
      await client.query("ROLLBACK");
      return;
    }

    // entered + 좌석 확정 완료 세션 존재 → ticketed 백필
    await client.query(
      `UPDATE public.event_registrations er
       SET status = 'ticketed'
       FROM public.live_sessions ls
       WHERE er.event_id = $1
         AND er.status = 'entered'
         AND ls.event_id = $1
         AND ls.user_id = er.user_id
         AND ls.status = 'completed'`,
      [eventId],
    );

    // 나머지 entered → no_show (좌석 확정 못 한 경우)
    await client.query(
      `UPDATE public.event_registrations
       SET status = 'no_show'
       WHERE event_id = $1 AND status = 'entered'`,
      [eventId],
    );

    // pending → missed (아예 세션 시작 안 함)
    await client.query(
      `UPDATE public.event_registrations
       SET status = 'missed'
       WHERE event_id = $1 AND status = 'pending'`,
      [eventId],
    );

    await client.query("COMMIT");
    console.log(`[event/scheduler] event ${eventId} → closed`);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    console.error(`[event/scheduler] transitionToClosed(${eventId}) failed:`, err);
  } finally {
    client.release();
  }
}

// ─── 스케줄 등록/취소 ────────────────────────────────────────────────────────

/**
 * 특정 이벤트의 open/close 타이머 등록.
 * opens_at 이 과거면 즉시 open 실행. closes_at 이 과거면 즉시 close 실행.
 * 기존 등록이 있으면 먼저 취소 후 재등록.
 */
export function scheduleEvent(
  eventId: number,
  opensAt: Date,
  closesAt: Date,
): void {
  cancelScheduledEvent(eventId);

  const now = Date.now();
  const openDelay = opensAt.getTime() - now;
  const closeDelay = closesAt.getTime() - now;

  const timers: EventTimers = { openTimer: null, closeTimer: null };

  if (openDelay <= 0) {
    // 이미 지난 시각 — 즉시 전이 시도 (백필 경로)
    void transitionToOpen(eventId);
  } else {
    timers.openTimer = longSetTimeout(() => {
      void transitionToOpen(eventId);
    }, openDelay);
  }

  if (closeDelay <= 0) {
    void transitionToClosed(eventId);
  } else {
    timers.closeTimer = longSetTimeout(() => {
      void transitionToClosed(eventId);
      scheduledTimers.delete(eventId);
    }, closeDelay);
  }

  scheduledTimers.set(eventId, timers);
}

/**
 * 등록된 open/close 타이머 취소. 이벤트 취소·수정 시 호출.
 */
export function cancelScheduledEvent(eventId: number): void {
  const existing = scheduledTimers.get(eventId);
  if (!existing) return;
  if (existing.openTimer)  clearTimeout(existing.openTimer);
  if (existing.closeTimer) clearTimeout(existing.closeTimer);
  scheduledTimers.delete(eventId);
}

// ─── 부팅 백필 ───────────────────────────────────────────────────────────────

/**
 * 서버 부팅 시 미래·진행 중 이벤트 전체를 다시 예약한다.
 *   - status='scheduled' 이면서 closes_at > NOW() → open/close 타이머 등록
 *     (opens_at 이 이미 지났으면 즉시 open, 뒤이어 close 예약)
 *   - status='open' 이면서 closes_at > NOW()      → close 타이머만 등록
 *   - closes_at <= NOW() 인 대상은 즉시 close 처리로 밀린 발화 백필
 */
export async function bootstrapEventSchedules(): Promise<void> {
  try {
    const res = await pool.query(
      `SELECT id, opens_at, closes_at, status
       FROM public.events
       WHERE status IN ('scheduled', 'open')`,
    );

    for (const row of res.rows) {
      const opensAt: Date  = row.opens_at;
      const closesAt: Date = row.closes_at;
      scheduleEvent(row.id as number, opensAt, closesAt);
    }

    console.log(`[event/scheduler] bootstrapped ${res.rows.length} event(s)`);
  } catch (err) {
    console.error("[event/scheduler] bootstrap failed:", err);
  }
}

/**
 * 스케줄러 시작 진입점. server.ts 에서 호출.
 * NODE_ENV=test 면 부팅 백필도 건너뛴다 (테스트 격리).
 */
export async function startEventScheduler(): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  await bootstrapEventSchedules();
  console.log("[event/scheduler] started");
}

// ─── 테스트/디버그 헬퍼 ──────────────────────────────────────────────────────

/** 등록된 타이머 개수 (테스트/모니터링) */
export function getScheduledEventCount(): number {
  return scheduledTimers.size;
}

/** 전체 타이머 초기화 (테스트 격리) */
export function clearAllScheduledEvents(): void {
  for (const [eventId] of scheduledTimers) {
    cancelScheduledEvent(eventId);
  }
}

// 내부 헬퍼도 테스트 목적으로 노출
export { transitionToOpen, transitionToClosed };
