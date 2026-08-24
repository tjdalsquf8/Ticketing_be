-- Migration: add_live_participate_columns
-- Purpose: 실시간 티켓팅 참가 대기열(queue) 지원을 위한 컬럼·인덱스 추가
-- Apply: psql -U <user> -d ticketingweb -f src/db/migrations/add_live_participate_columns.sql
-- After applying: npm run db:dump && mv this file src/db/migrations/_archive/

-- 1. live_sessions.status CHECK 제약 확장: 'queued' 값 추가
--    기존: ('active', 'completed', 'failed')
--    변경: ('queued', 'active', 'completed', 'failed')
ALTER TABLE public.live_sessions
  DROP CONSTRAINT IF EXISTS live_sessions_status_check;

ALTER TABLE public.live_sessions
  ADD CONSTRAINT live_sessions_status_check
  CHECK ((status::text = ANY (ARRAY['queued', 'active', 'completed', 'failed']::text[])));

-- 2. queue_position 컬럼 추가 (대기열 순번, NULL = 대기열 외)
ALTER TABLE public.live_sessions
  ADD COLUMN IF NOT EXISTS queue_position INTEGER NULL;

-- 3. Partial unique index: 동일 round에서 같은 회원이 중복 참가 방지
--    (queued, active, completed 상태에서만 적용; failed는 재시도 허용)
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_sessions_round_user_active
  ON public.live_sessions (round_id, user_id)
  WHERE user_id IS NOT NULL
    AND status IN ('queued', 'active', 'completed');

-- 4. Partial unique index: 동일 round에서 같은 게스트(UUID)가 중복 참가 방지
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_sessions_round_guest_active
  ON public.live_sessions (round_id, guest_uuid)
  WHERE guest_uuid IS NOT NULL
    AND status IN ('queued', 'active', 'completed');
