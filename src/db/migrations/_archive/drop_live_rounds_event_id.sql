-- live_rounds.event_id 컬럼 제거
--
-- 실시간 티켓팅은 이벤트와 완전 분리. live_rounds 는 venue_id 만 참조하고
-- events 와의 결합은 스키마상 이미 없었다(FK 미존재). NOT NULL 잔재 컬럼을
-- 제거해 의미 없는 값 채워넣기를 없앤다.

BEGIN;

ALTER TABLE public.live_rounds DROP COLUMN event_id;

COMMIT;
