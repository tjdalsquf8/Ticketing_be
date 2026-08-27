-- live_rounds 에 venue_id FK 추가
-- 기존 테스트 데이터 전부 삭제 (ON DELETE CASCADE 확인됨)

-- 1. live_rounds CASCADE 삭제 (live_sessions, live_seats, live_holds, live_waiting은 CASCADE로 자동 삭제됨)
--    tickets.round_id 도 ON DELETE CASCADE 이므로 함께 정리됨
TRUNCATE TABLE public.live_rounds CASCADE;

-- 시퀀스 초기화 (선택적 — 새 데이터를 1번부터 시작하고 싶을 때)
ALTER SEQUENCE public.live_rounds_id_seq RESTART WITH 1;
ALTER SEQUENCE public.live_sessions_id_seq RESTART WITH 1;
ALTER SEQUENCE public.live_seats_id_seq RESTART WITH 1;
ALTER SEQUENCE public.live_holds_id_seq RESTART WITH 1;
ALTER SEQUENCE public.live_waiting_id_seq RESTART WITH 1;

-- 2. venue_id 컬럼 추가 (일단 nullable로 — 기존 데이터 없으니 바로 NOT NULL 가능)
ALTER TABLE public.live_rounds
  ADD COLUMN venue_id INTEGER NOT NULL
    REFERENCES public.venues(id) ON DELETE RESTRICT;

-- 3. 인덱스 추가
CREATE INDEX idx_live_rounds_venue ON public.live_rounds (venue_id);
