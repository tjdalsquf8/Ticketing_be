-- 활성 좌석 hold (만료·확정·해제 시 삭제)
-- actor_key: 'u:<user_id>' (회원) 또는 'g:<guest_uuid>' (게스트)
-- UNIQUE(round_id, seat_id): 같은 좌석 동시 hold 방지 (원자 INSERT 경합의 뿌리)
-- UNIQUE(round_id, actor_key): 유저당 활성 hold 1개 강제
CREATE TABLE IF NOT EXISTS live_holds (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES live_rounds(id) ON DELETE CASCADE,
  seat_id INTEGER NOT NULL REFERENCES live_seats(id) ON DELETE CASCADE,
  actor_key VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (round_id, seat_id),
  UNIQUE (round_id, actor_key)
);

CREATE INDEX IF NOT EXISTS idx_live_holds_expires_at ON live_holds (expires_at);
