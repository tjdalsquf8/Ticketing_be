-- 기프티콘 재고 (유료 이벤트 상품). status enum은 미리 정의만 하고
-- available -> issued/redeemed/expired 전이는 후속 기능(지급/사용)에서 구현.
CREATE TABLE IF NOT EXISTS public.gifticons (
  id SERIAL PRIMARY KEY,
  category VARCHAR(20) NOT NULL
    CHECK (category IN ('coffee', 'food', 'convenience', 'beauty', 'etc')),
  product_name VARCHAR(80) NOT NULL,
  face_value INTEGER NOT NULL CHECK (face_value > 0),
  code VARCHAR(64) NOT NULL UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'issued', 'redeemed', 'expired')),
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gifticons_category ON public.gifticons (category);
CREATE INDEX IF NOT EXISTS idx_gifticons_status ON public.gifticons (status);

-- 상세 조회(원본 코드 노출) 감사로그: 조회자·시각·대상 id
CREATE TABLE IF NOT EXISTS public.gifticon_view_logs (
  id SERIAL PRIMARY KEY,
  gifticon_id INTEGER NOT NULL REFERENCES public.gifticons(id) ON DELETE CASCADE,
  viewed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gifticon_view_logs_gifticon_id ON public.gifticon_view_logs (gifticon_id);
