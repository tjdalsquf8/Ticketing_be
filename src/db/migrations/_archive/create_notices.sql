-- 공지사항. draft 상태 없음 — insert 즉시 공개 노출.
CREATE TABLE IF NOT EXISTS public.notices (
  id SERIAL PRIMARY KEY,
  kind VARCHAR(16) NOT NULL
    CHECK (kind IN ('notice', 'update', 'fix')),
  title VARCHAR(120) NOT NULL,
  href VARCHAR(500),
  content TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notices_created_at ON public.notices (created_at DESC);
