-- venues 에 slug 컬럼 추가 + layout CHECK 제약 6종
-- 기존 venue 데이터 없음(count=0) 확인 후 진행

-- 1. slug 컬럼 추가 (NOT NULL은 seed 이후 적용)
ALTER TABLE public.venues
  ADD COLUMN slug character varying(50);

-- 2. layout CHECK 제약 추가 (기존 컬럼 타입 유지, 값만 제한)
ALTER TABLE public.venues
  ADD CONSTRAINT venues_layout_check
  CHECK (layout IN (
    'arena-ring',
    'baseball',
    'stadium-oval',
    'proscenium',
    'festival',
    'auditorium'
  ));

-- 3. slug UNIQUE 제약 추가
ALTER TABLE public.venues
  ADD CONSTRAINT venues_slug_key UNIQUE (slug);

-- 4. slug 인덱스 추가
CREATE INDEX idx_venues_slug ON public.venues (slug);
