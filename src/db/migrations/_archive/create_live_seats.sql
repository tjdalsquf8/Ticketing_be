-- 회차별 좌석 인스턴스 (round open 시 seat_labels로부터 벌크 INSERT)
-- status 전이: available → held → sold (또는 만료로 available 복귀)
CREATE TABLE IF NOT EXISTS live_seats (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES live_rounds(id) ON DELETE CASCADE,
  seat_label VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'held', 'sold')),
  sold_session_id VARCHAR(32),
  UNIQUE (round_id, seat_label)
);

CREATE INDEX IF NOT EXISTS idx_live_seats_round_status ON live_seats (round_id, status);
