-- 티켓 재화(구 포인트) 제거.
--
-- 유료 이벤트 참가비가 기획에서 빠졌다. 사전 신청은 로그인 유저면 누구나 무료로
-- 가능하고, 잔액 부족·취소 환불 개념이 없어졌다. 이에 따라:
--   - users.tickets (잔액)
--   - events / event_series.entry_fee_tickets (참가비)
--   - event_registrations.tickets_paid / refund_tickets / refunded_at (결제·환불 이력)
-- 을 모두 제거한다.
--
-- 신청 상태 'refunded' 도 함께 없앤다. 환불이 없으므로 관리자 이벤트 취소로 무효화된
-- 신청은 유저 자발 취소와 같은 'cancelled' 로 통합한다.
--
-- Apply: psql -U <user> -d ticketingweb -f src/db/migrations/drop_ticket_currency.sql

BEGIN;

-- 1) 기존 refunded 행을 cancelled 로 이관. cancelled_at 이 비어 있으면 refunded_at 으로 채운다.
UPDATE public.event_registrations
   SET status       = 'cancelled',
       cancelled_at = COALESCE(cancelled_at, refunded_at, NOW())
 WHERE status = 'refunded';

-- 2) status CHECK 재작성 (refunded 제거)
ALTER TABLE public.event_registrations
  DROP CONSTRAINT IF EXISTS event_registrations_status_check;

ALTER TABLE public.event_registrations
  ADD CONSTRAINT event_registrations_status_check
  CHECK (status::text = ANY (ARRAY[
    'pending'::character varying,
    'entered'::character varying,
    'ticketed'::character varying,
    'missed'::character varying,
    'no_show'::character varying,
    'cancelled'::character varying
  ]::text[]));

-- 3) 결제·환불 컬럼 제거 (연결된 CHECK 제약도 함께 삭제됨)
ALTER TABLE public.event_registrations
  DROP COLUMN IF EXISTS tickets_paid,
  DROP COLUMN IF EXISTS refund_tickets,
  DROP COLUMN IF EXISTS refunded_at;

-- 4) 참가비 컬럼 제거
ALTER TABLE public.events       DROP COLUMN IF EXISTS entry_fee_tickets;
ALTER TABLE public.event_series DROP COLUMN IF EXISTS entry_fee_tickets;

-- 5) 잔액 컬럼 제거 (users_tickets_check 도 함께 삭제됨)
ALTER TABLE public.users DROP COLUMN IF EXISTS tickets;

COMMIT;
