-- 라이브 세션 (practice_sessions와 대칭 구조)
-- session_id 형식: 'lv_' + 16 hex (crypto.randomBytes(8))
-- 소요시간은 서버가 completed_at - started_at으로 재계산 (클라이언트 값 신뢰 X)
CREATE TABLE IF NOT EXISTS live_sessions (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(20) UNIQUE NOT NULL,
  round_id INTEGER NOT NULL REFERENCES live_rounds(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  guest_uuid VARCHAR(36),
  nickname VARCHAR(30) NOT NULL,
  seat_label VARCHAR(32),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  elapsed_ms INTEGER,
  status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'failed')),
  CHECK (user_id IS NOT NULL OR guest_uuid IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_live_sessions_round_status ON live_sessions (round_id, status);
-- 종료 훅의 top10 정렬용
CREATE INDEX IF NOT EXISTS idx_live_sessions_round_elapsed_completed
  ON live_sessions (round_id, elapsed_ms)
  WHERE status = 'completed';
