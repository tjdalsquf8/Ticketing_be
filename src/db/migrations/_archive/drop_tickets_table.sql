-- 티켓 개념 완전 제거
--
-- 배경:
--   "티켓"은 라이브·연습 티켓팅의 보상 장치였으나 기획에서 빠졌다. 그 자리는
--   /live, /practice 의 인라인 랭킹이 대신한다.
--
--   유료 이벤트 TOP3 기프티콘 정산은 유지되지만, 판정 근거를 tickets.rank 에서
--   live_sessions.elapsed_ms 정렬로 옮긴다. 기존 tickets.rank 는 좌석 확정 시점에
--   "그때까지 완주한 사람" 기준으로 매겨진 데다 (event_id, rank) unique 충돌 시
--   MAX(rank)+1 로 밀려서, 실제 3등이 rank 4 로 기록돼 지급 대상에서 빠질 수 있었다.
--
-- ⚠️ 파괴적 변경. 실행 전 백업 필수.
--   프로덕션 적용 전 gifticon_settlements 건수를 반드시 확인할 것.
--   지급 이력이 있으면 아래 UPDATE 로 live_session_id 가 백필되지만,
--   해당 티켓의 live_session_id 가 NULL 인 행이 있으면 NOT NULL 설정에서 실패한다.

-- 1) 정산 이력의 참조 대상을 tickets → live_sessions 로 이관
ALTER TABLE public.gifticon_settlements ADD COLUMN live_session_id integer;

UPDATE public.gifticon_settlements gs
SET live_session_id = t.live_session_id
FROM public.tickets t
WHERE t.id = gs.ticket_id;

ALTER TABLE public.gifticon_settlements
  ALTER COLUMN live_session_id SET NOT NULL,
  DROP COLUMN ticket_id,
  ADD CONSTRAINT gifticon_settlements_live_session_id_key
    UNIQUE (live_session_id),
  ADD CONSTRAINT gifticon_settlements_live_session_id_fkey
    FOREIGN KEY (live_session_id) REFERENCES public.live_sessions(id) ON DELETE CASCADE;

-- 2) event_registrations 의 티켓 참조 제거
--    (완주 여부는 live_sessions.status = 'completed' 로 판정한다)
ALTER TABLE public.event_registrations DROP COLUMN ticket_id;

-- 3) 티켓 테이블 제거
DROP TABLE public.tickets;

-- 4) 새 조회 경로용 인덱스
--    GET /rankings/me — user_id 로 본인 기록만 훑는다
CREATE INDEX idx_live_sessions_user_started
  ON public.live_sessions (user_id, started_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX idx_practice_sessions_user_started
  ON public.practice_sessions (user_id, started_at DESC)
  WHERE user_id IS NOT NULL;

--    GET /stats/daily — 오늘 완주 수 / 이번주 최고기록
CREATE INDEX idx_live_sessions_completed_at
  ON public.live_sessions (completed_at)
  WHERE status = 'completed';

--    기프티콘 정산 TOP3 판정 — 이벤트별 elapsed_ms 정렬
CREATE INDEX idx_live_sessions_event_elapsed
  ON public.live_sessions (event_id, elapsed_ms)
  WHERE event_id IS NOT NULL AND status = 'completed';
