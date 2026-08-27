-- live_config 에 default_venue_id 추가, default_event_id 제거
--
-- 실시간 티켓팅은 이벤트와 완전 분리된 독립 도메인. 회차 생성 시 events 테이블
-- 을 JOIN 해 venue_id 를 뽑는 대신 live_config 에 직접 default_venue_id 를
-- 두고 참조한다.
--
-- 백필: 기존 default_event_id 값 무시하고 venue id=1 (kspo-dome-v1) 로 세팅.
-- 운영 DB 반영 시 실제 사용할 venue id 로 값 조정 필요.

BEGIN;

ALTER TABLE public.live_config ADD COLUMN default_venue_id integer;

UPDATE public.live_config SET default_venue_id = 1 WHERE id = 1;

ALTER TABLE public.live_config ALTER COLUMN default_venue_id SET NOT NULL;

ALTER TABLE public.live_config
  ADD CONSTRAINT live_config_default_venue_id_fkey
  FOREIGN KEY (default_venue_id) REFERENCES public.venues(id) ON DELETE RESTRICT;

ALTER TABLE public.live_config DROP COLUMN default_event_id;

COMMIT;
