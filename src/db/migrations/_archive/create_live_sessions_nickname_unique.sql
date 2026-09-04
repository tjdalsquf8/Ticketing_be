-- 회차 내 게스트 닉네임 중복 방지. 회원(user_id) 닉네임은 대상 아님 —
-- 계정명 충돌까지 막을 필요는 없고, 오라클/충돌 우려가 있는 건 게스트 사칭 케이스뿐.
-- uq_live_sessions_round_guest_active(round_id, guest_uuid) 와 동일한 partial 패턴.
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_sessions_round_nickname_guest
  ON public.live_sessions (round_id, nickname)
  WHERE (guest_uuid IS NOT NULL AND status IN ('queued', 'active', 'completed'));
