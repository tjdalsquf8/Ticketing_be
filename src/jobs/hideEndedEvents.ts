import cron from "node-cron";
import pool from "../config/db";

/**
 * ─── 종료·취소 이벤트 자동 숨김 크론 ──────────────────────────────────────────
 *
 * 매일 KST 00시에 status IN ('closed','cancelled') 이면서 hidden_at IS NULL 인
 * 이벤트를 찾아 hidden_at = NOW() 로 세팅한다. 공개 조회 엔드포인트는
 * hidden_at IS NULL 을 필터하므로 사용자 목록에서 사라진다. DB 데이터·통계·
 * 랭킹 계산은 그대로 유지 (soft delete).
 *
 * 관리자 페이지에서는 hidden 이벤트도 계속 조회 가능하며, 서버 다운타임으로
 * 크론 발화가 밀렸을 때를 대비해 POST /api/admin/events/cleanup 수동 실행
 * 엔드포인트 제공.
 */

const TIMEZONE = "Asia/Seoul";
const HIDE_SCHEDULE = "0 0 * * *"; // 매일 KST 00시

export interface HideEndedEventsResult {
  hiddenCount: number;
  durationMs: number;
}

/**
 * 실제 숨김 처리. 서버 부팅 시 1회 + 매일 00시 크론 + 관리자 수동 실행에서 재사용.
 * rowCount 와 소요 시간을 반환해 관리자 응답/로그에 활용.
 */
export async function runHideEndedEvents(): Promise<HideEndedEventsResult> {
  const startedAt = Date.now();
  const res = await pool.query(
    `UPDATE public.events
        SET hidden_at = NOW()
      WHERE status IN ('closed', 'cancelled')
        AND hidden_at IS NULL`,
  );
  const hiddenCount = res.rowCount ?? 0;
  const durationMs = Date.now() - startedAt;
  if (hiddenCount > 0) {
    console.log(`[events/hide] hid ${hiddenCount} event(s) in ${durationMs}ms`);
  }
  return { hiddenCount, durationMs };
}

const runHide = async () => {
  try {
    await runHideEndedEvents();
  } catch (err) {
    console.error("[events/hide] failed:", err);
  }
};

/**
 * server.ts 진입점. NODE_ENV=test 면 크론 등록·부팅 실행 모두 스킵.
 * 부팅 시 1회 실행으로 다운타임 동안 밀린 대상 즉시 처리.
 */
export const startHideEndedEventsCron = () => {
  if (process.env.NODE_ENV === "test") return;

  cron.schedule(HIDE_SCHEDULE, runHide, { timezone: TIMEZONE });
  console.log(
    `[events/hide] cron registered (schedule=${HIDE_SCHEDULE}, tz=${TIMEZONE})`,
  );

  void runHide();
};
