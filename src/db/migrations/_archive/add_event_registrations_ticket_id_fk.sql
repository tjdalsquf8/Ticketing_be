-- 목적: event_registrations.ticket_id 컬럼에 tickets(id) FK 제약 추가.
-- 이유: 스키마 초기 생성 파일(create_events_schema.sql)에서 주석으로만 FK 의도를
--       서술하고 실제 제약이 누락돼 있었음. orphan ticket_id 저장·티켓 삭제 시
--       참조 정합성 붕괴 가능. 기존 event_id/user_id FK 정책과 동일하게 RESTRICT.
--
-- 사전 정리: 만약 이미 존재하는 orphan 행이 있으면 FK ADD 가 실패한다. 아래
--            SELECT 로 사전 점검 후 필요 시 별도 수동 정리(NULL 처리 등) 수행.
--
--   SELECT er.id, er.ticket_id
--   FROM public.event_registrations er
--   LEFT JOIN public.tickets t ON t.id = er.ticket_id
--   WHERE er.ticket_id IS NOT NULL AND t.id IS NULL;

ALTER TABLE public.event_registrations
  ADD CONSTRAINT event_registrations_ticket_id_fkey
  FOREIGN KEY (ticket_id) REFERENCES public.tickets(id)
  ON DELETE RESTRICT;
