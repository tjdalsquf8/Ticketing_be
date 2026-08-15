-- 라이브 기본 규칙 (singleton row: id = 1 강제)
-- 매시 정각 회차 생성 시 override가 없으면 이 값을 스냅샷으로 사용
CREATE TABLE IF NOT EXISTS live_config (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_event_id INTEGER NOT NULL,
  default_seat_labels JSONB NOT NULL,
  excluded_hours INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
