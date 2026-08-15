-- 매 정각 회차 인스턴스
-- opens_at 도달 시 크론이 status='scheduled' → 'open' 전이 + live_seats 벌크 INSERT
-- closes_at (=opens_at + 5min) 도달 시 'open' → 'closed' 전이 + top10 티켓 배치
CREATE TABLE IF NOT EXISTS live_rounds (
  id SERIAL PRIMARY KEY,
  opens_at TIMESTAMPTZ NOT NULL UNIQUE,
  closes_at TIMESTAMPTZ NOT NULL,
  event_id INTEGER NOT NULL,
  seat_labels JSONB NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'open', 'closed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (opens_at < closes_at)
);

CREATE INDEX IF NOT EXISTS idx_live_rounds_status ON live_rounds (status);
CREATE INDEX IF NOT EXISTS idx_live_rounds_opens_at_desc ON live_rounds (opens_at DESC);
