-- tickets.event_id NULLABLE 로 완화
--
-- 이벤트 실시간 티켓팅 시엔 event_id 채우고 round_id=NULL,
-- 실시간 라운드 티켓팅 시엔 round_id 채우고 event_id=NULL 로 저장.
-- 기존 NOT NULL 제약은 라운드 티켓 발급 시 의미 없는 event_id 를 강제로
-- 넣게 만드는 legacy 결합이었음.

BEGIN;

ALTER TABLE public.tickets ALTER COLUMN event_id DROP NOT NULL;

COMMIT;
