-- 공지 상세 본문 추가. href(관리자 직접 URL)는 API 계약에서 더 이상 안 씀 —
-- 모든 공지가 항상 자기 상세페이지(/notices/:id)로 연결되는 구조로 바뀌어 불필요해졌으나,
-- 컬럼 자체는 남겨둔다(데이터 보존, 필요 시 별도 정리).
ALTER TABLE public.notices ADD COLUMN content TEXT;
