-- live_sessions, live_seats, live_holds 에 event_id 컬럼 추가 및 round_id nullable 변경
-- 이벤트 티켓팅 세션을 live_* 인프라에서 재사용하기 위한 마이그레이션

-- ─── 1. live_sessions ───────────────────────────────────────────────────────

-- round_id nullable 로 변경 (기존 라이브 세션은 영향 없음)
ALTER TABLE public.live_sessions
    ALTER COLUMN round_id DROP NOT NULL;

-- event_id 컬럼 추가
ALTER TABLE public.live_sessions
    ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES public.events(id) ON DELETE RESTRICT;

-- round_id / event_id 중 하나는 반드시 있어야 한다는 CHECK 추가
ALTER TABLE public.live_sessions
    ADD CONSTRAINT live_sessions_context_check
    CHECK (round_id IS NOT NULL OR event_id IS NOT NULL);

-- event_id 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_live_sessions_event_id
    ON public.live_sessions USING btree (event_id);

-- ─── 2. live_seats ──────────────────────────────────────────────────────────

-- round_id nullable 로 변경
ALTER TABLE public.live_seats
    ALTER COLUMN round_id DROP NOT NULL;

-- event_id 컬럼 추가
ALTER TABLE public.live_seats
    ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES public.events(id) ON DELETE RESTRICT;

-- round_id / event_id 중 하나는 반드시 있어야 한다
ALTER TABLE public.live_seats
    ADD CONSTRAINT live_seats_context_check
    CHECK (round_id IS NOT NULL OR event_id IS NOT NULL);

-- event_id 기반 좌석 중복 방지 unique 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_seats_event_label
    ON public.live_seats (event_id, seat_label)
    WHERE event_id IS NOT NULL;

-- ─── 3. live_holds ──────────────────────────────────────────────────────────

-- round_id nullable 로 변경
ALTER TABLE public.live_holds
    ALTER COLUMN round_id DROP NOT NULL;

-- event_id 컬럼 추가
ALTER TABLE public.live_holds
    ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES public.events(id) ON DELETE RESTRICT;

-- round_id / event_id 중 하나는 반드시 있어야 한다
ALTER TABLE public.live_holds
    ADD CONSTRAINT live_holds_context_check
    CHECK (round_id IS NOT NULL OR event_id IS NOT NULL);

-- 기존 (round_id, actor_key) unique 는 event 세션과 충돌하지 않으므로 유지.
-- event 세션 중복 hold 방지: (event_id, actor_key) unique partial index
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_holds_event_actor
    ON public.live_holds (event_id, actor_key)
    WHERE event_id IS NOT NULL;
