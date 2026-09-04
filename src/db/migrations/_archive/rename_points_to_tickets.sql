-- "포인트" 명칭 제거: 사업자 등록 전까지 포인트(선불 충전금 성격) 명칭을 쓰지 않고
-- 실시간 티켓팅으로 획득한 "티켓"을 이벤트 사전신청에 소진하는 구조로 통일한다.
-- 차감/적립 로직 자체는 유지, 컬럼명만 tickets 계열로 변경.

ALTER TABLE public.users RENAME COLUMN points TO tickets;
ALTER TABLE public.users RENAME CONSTRAINT users_points_check TO users_tickets_check;

ALTER TABLE public.event_registrations RENAME COLUMN points_paid TO tickets_paid;
ALTER TABLE public.event_registrations RENAME COLUMN refund_points TO refund_tickets;
ALTER TABLE public.event_registrations RENAME CONSTRAINT event_registrations_points_paid_check TO event_registrations_tickets_paid_check;
ALTER TABLE public.event_registrations RENAME CONSTRAINT event_registrations_refund_points_check TO event_registrations_refund_tickets_check;
