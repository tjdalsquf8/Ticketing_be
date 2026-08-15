-- 라이브 스케줄 override
-- action='off': 해당 기간 회차 미생성
-- action='swap': 해당 기간 회차의 event_id / seat_labels 교체
-- 겹치는 override는 created_at 최신 우선 (서비스 레이어에서 판정)
CREATE TABLE IF NOT EXISTS live_overrides (
  id SERIAL PRIMARY KEY,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to   TIMESTAMPTZ NOT NULL,
  action VARCHAR(16) NOT NULL CHECK (action IN ('off', 'swap')),
  swap_event_id INTEGER,
  swap_seat_labels JSONB,
  memo VARCHAR(200),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_from < effective_to),
  CHECK (
    (action = 'off'  AND swap_event_id IS NULL     AND swap_seat_labels IS NULL)
    OR
    (action = 'swap' AND swap_event_id IS NOT NULL AND swap_seat_labels IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_live_overrides_range
  ON live_overrides (effective_from, effective_to);
