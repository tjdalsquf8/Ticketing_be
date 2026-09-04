-- entry_fee_tickets 컬럼 리네임(rename_entry_fee_points_to_tickets.sql) 당시
-- 남겨졌던 CHECK 제약 이름의 잔재를 정리한다.

ALTER TABLE public.events RENAME CONSTRAINT events_entry_fee_points_check TO events_entry_fee_tickets_check;
ALTER TABLE public.event_series RENAME CONSTRAINT event_series_entry_fee_points_check TO event_series_entry_fee_tickets_check;
