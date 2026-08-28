-- refresh_token 컬럼을 해시 저장 전용으로 전환
-- - 평문 JWT 저장 → sha256 hex(64자) 저장으로 스키마 변경
-- - 기존 저장 값은 원문 JWT라 해시를 역산할 수 없으므로 NULL로 초기화
--   (전 유저 강제 재로그인 발생)
-- - rotation 도입으로 refresh 호출마다 이 컬럼도 새 hash로 교체됨

BEGIN;

UPDATE public.users SET refresh_token = NULL;

ALTER TABLE public.users RENAME COLUMN refresh_token TO refresh_token_hash;

ALTER TABLE public.users
  ALTER COLUMN refresh_token_hash TYPE char(64);

COMMIT;
