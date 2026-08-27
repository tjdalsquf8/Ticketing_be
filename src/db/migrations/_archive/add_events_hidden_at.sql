-- events.hidden_at: 종료·취소 이벤트를 공개 목록에서 숨김 처리하는 시각.
-- 매일 KST 00시 크론이 status IN ('closed','cancelled') AND hidden_at IS NULL 대상에 NOW() 세팅.
-- DB 데이터는 그대로 두고 조회 시점에만 필터로 감춘다 (soft delete).

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS hidden_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_events_hidden_at
  ON public.events (hidden_at);

-- 크론 배치 쿼리 최적화용 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_events_status_hidden_at
  ON public.events (status, hidden_at);

-- 기존 종료·취소 이벤트 백필 (즉시 숨김)
UPDATE public.events
   SET hidden_at = NOW()
 WHERE status IN ('closed', 'cancelled')
   AND hidden_at IS NULL;
