-- live_sessions 에 heartbeat 컬럼 추가.
-- 목적: queued/active 세션은 명시적 취소(POST /abandon) 또는 회차 종료 전까지
--       자동 만료가 없어, 탭을 강제로 닫거나 네트워크가 끊긴 사용자의 세션이
--       DB 에 영구히 남아 대기열 순번과 active 정원을 계속 잡아먹는 문제가 있었다.
--       (부하 테스트로 재현: k6 VU가 중간에 끊기면 좌석 확정까지 못 간 세션이
--        queued/active 상태로 영구히 남아, 이후 실제 사용자가 그 뒤로 줄을 섰다.)
--
-- 대응: 세션에 손이 갈 때마다(대기열 폴링·좌석맵 조회·hold·confirm) last_seen_at
--       을 갱신하고, liveScheduler 의 sweep 크론이 일정 시간 heartbeat 없는
--       queued/active 세션을 failed 로 정리한다.

ALTER TABLE live_sessions
  ADD COLUMN last_seen_at timestamp with time zone DEFAULT now() NOT NULL;

CREATE INDEX idx_live_sessions_heartbeat_sweep
  ON live_sessions (status, last_seen_at)
  WHERE status IN ('queued', 'active');
