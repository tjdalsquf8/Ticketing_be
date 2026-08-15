-- 대기실 진입자 (실 데이터 기반 대기 인원 카운트)
-- 회원/게스트 모두 진입 가능. UNIQUE로 중복 진입 방지.
CREATE TABLE IF NOT EXISTS live_waiting (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES live_rounds(id) ON DELETE CASCADE,
  actor_key VARCHAR(64) NOT NULL,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (round_id, actor_key)
);

CREATE INDEX IF NOT EXISTS idx_live_waiting_round ON live_waiting (round_id);
