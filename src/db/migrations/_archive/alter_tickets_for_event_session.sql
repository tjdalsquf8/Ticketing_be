-- tickets 테이블: 이벤트 세션 티켓 지원을 위한 round_id nullable 변경
-- 이벤트 티켓은 round_id = NULL, event_id = 이벤트 ID

-- round_id nullable 로 변경
ALTER TABLE public.tickets
    ALTER COLUMN round_id DROP NOT NULL;

-- round_id → live_rounds FK를 DEFERRABLE 로 변경 불가, FK 재설정 (nullable 허용)
-- (FK 자체는 nullable 컬럼에서 NULL 값은 검사하지 않으므로 그대로 유지)

-- 기존 uq_tickets_round_rank 는 (round_id, rank) 유니크.
-- NULL 값은 PG에서 유니크 제약 비교 시 서로 달리 취급되므로 round_id=NULL인 이벤트 티켓끼리 충돌 안 함.
-- 단, 이벤트 세션 내 (event_id, rank) 유니크 보장을 위해 partial index 추가.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_event_rank
    ON public.tickets (event_id, rank)
    WHERE round_id IS NULL;

-- event_id 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_tickets_event
    ON public.tickets USING btree (event_id)
    WHERE round_id IS NULL;
