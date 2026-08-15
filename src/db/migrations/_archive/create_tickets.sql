-- 라이브 회차 top10 회원에게 지급 (게스트 제외)
-- 발급 시점 스냅샷: passenger_nickname·event_title·rank 등 (원본 변경과 무관)
-- serial 형식: 'TR-YYYYMMDD-XXXXX' (프론트 명세)
CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  live_session_id INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  round_id INTEGER NOT NULL REFERENCES live_rounds(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL,
  passenger_nickname VARCHAR(30) NOT NULL,
  serial VARCHAR(32) UNIQUE NOT NULL,
  stub_no VARCHAR(16),
  seat_label VARCHAR(32) NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  rank SMALLINT NOT NULL,
  total_participants INTEGER NOT NULL,
  qr_payload VARCHAR(200) NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_user_issued ON tickets (user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_round ON tickets (round_id);
