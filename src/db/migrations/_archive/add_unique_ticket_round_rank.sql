-- 같은 회차(round_id) 내 동일한 순위(rank) 티켓 중복 발급 방지
-- confirmSeat 에서 두 요청이 동시에 같은 rank 를 계산하더라도
-- 한 쪽 INSERT 가 unique violation 을 발생시켜 재시도 분기로 진입한다.
ALTER TABLE public.tickets
  ADD CONSTRAINT uq_tickets_round_rank UNIQUE (round_id, rank);
