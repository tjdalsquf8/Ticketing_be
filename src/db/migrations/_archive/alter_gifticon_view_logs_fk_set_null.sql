-- 재고(gifticons) 삭제 시 gifticon_view_logs 감사로그가 CASCADE로 함께 지워지던 문제 수정.
-- "원본 코드를 누가 언제 봤는지"는 그 재고가 삭제된 뒤에도 남아있어야 감사 목적을 달성함.
-- gifticon_id를 NULL 허용으로 바꾸고 FK를 SET NULL로 교체 (로그 행 자체는 보존).
ALTER TABLE public.gifticon_view_logs
  ALTER COLUMN gifticon_id DROP NOT NULL;

ALTER TABLE public.gifticon_view_logs
  DROP CONSTRAINT gifticon_view_logs_gifticon_id_fkey;

ALTER TABLE public.gifticon_view_logs
  ADD CONSTRAINT gifticon_view_logs_gifticon_id_fkey
  FOREIGN KEY (gifticon_id) REFERENCES public.gifticons(id) ON DELETE SET NULL;
