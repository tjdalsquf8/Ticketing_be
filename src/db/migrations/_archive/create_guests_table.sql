CREATE TABLE IF NOT EXISTS public.guests (
  id SERIAL PRIMARY KEY,
  guest_uuid VARCHAR(36) NOT NULL UNIQUE,
  nickname VARCHAR(30) NOT NULL DEFAULT '익명유저',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guests_guest_uuid ON public.guests (guest_uuid);
