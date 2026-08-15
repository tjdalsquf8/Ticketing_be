-- 프론트팀 합의: 공연 스냅샷 컬럼은 백엔드에 저장하지 않음
-- 프론트가 event_id → title/venue/poster/category를 자체 매핑
ALTER TABLE tickets DROP COLUMN IF EXISTS event_title;
