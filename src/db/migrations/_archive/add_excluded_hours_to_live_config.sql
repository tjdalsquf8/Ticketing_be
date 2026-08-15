-- 관리자가 매일 특정 시간대(0~23시)를 라이브 회차 미생성으로 지정
-- 스케줄러가 KST 기준 hour 매칭하여 스킵. 빈 배열이 기본 (제외 없음)
ALTER TABLE live_config
ADD COLUMN IF NOT EXISTS excluded_hours INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
