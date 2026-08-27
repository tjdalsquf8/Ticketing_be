-- 목적: guests.nickname_changed_at 컬럼 추가.
-- 이유: 게스트 닉네임 변경(= guest_uuid 재발급) 최소 1시간 대기 정책의 서버측 방어
--       기준 필드. `updated_at` 은 postGuest upsert 시마다 갱신되므로 재사용 불가능.
-- 정책:
--   INSERT: DEFAULT NOW() 로 자동 세팅.
--   UPSERT: nickname 이 실제로 바뀌었을 때만 갱신. 같은 nickname 재요청은 무시.
-- 기존 행: 최초 발급 시각을 알 수 없으므로 안전하게 NOW() 로 초기화한다.
--          이 정책 적용 후 신규 발급/변경부터 정확히 카운트된다.

ALTER TABLE public.guests
  ADD COLUMN nickname_changed_at timestamptz NOT NULL DEFAULT NOW();
