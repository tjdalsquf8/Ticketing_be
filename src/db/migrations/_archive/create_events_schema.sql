-- 이벤트 · 시리즈 · 신청 · 공연장 스키마 생성
-- EVENT_API_SPEC.md v1.0 기준

-- ─── 공연장(Venue) ──────────────────────────────────────────────────────────────

CREATE TABLE public.venues (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    layout      VARCHAR(50)  NOT NULL,
    total_seats INTEGER      NOT NULL CHECK (total_seats > 0),
    thumbnail_url VARCHAR(500),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_venues_name ON public.venues USING btree (name);

-- ─── 이벤트 시리즈(EventSeries) ─────────────────────────────────────────────────

CREATE TABLE public.event_series (
    id              SERIAL PRIMARY KEY,
    title           VARCHAR(80)  NOT NULL,
    category        VARCHAR(20)  NOT NULL
                      CHECK (category IN ('concert','musical','sports','theater','festival')),
    venue_id        INTEGER      NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
    duration_ms     INTEGER      NOT NULL DEFAULT 300000,
    entry_fee_points INTEGER     NOT NULL DEFAULT 500 CHECK (entry_fee_points >= 0 AND entry_fee_points <= 100000),
    prize           VARCHAR(120) NOT NULL,
    poster_color    VARCHAR(7)   NOT NULL,
    poster_initial  VARCHAR(8)   NOT NULL DEFAULT '',
    recurrence      JSONB        NOT NULL,
    created_by      INTEGER      NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_event_series_venue ON public.event_series USING btree (venue_id);

-- ─── 이벤트(Event) ───────────────────────────────────────────────────────────────

CREATE TABLE public.events (
    id                    SERIAL PRIMARY KEY,
    type                  VARCHAR(10)  NOT NULL DEFAULT 'paid'
                            CHECK (type IN ('paid')),
    category              VARCHAR(20)  NOT NULL
                            CHECK (category IN ('concert','musical','sports','theater','festival')),
    title                 VARCHAR(80)  NOT NULL,
    venue_id              INTEGER      NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
    total_seats           INTEGER      NOT NULL CHECK (total_seats > 0),
    opens_at              TIMESTAMP WITH TIME ZONE NOT NULL,
    closes_at             TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_ms           INTEGER      NOT NULL DEFAULT 300000,
    entry_fee_points      INTEGER      NOT NULL DEFAULT 500
                            CHECK (entry_fee_points >= 0 AND entry_fee_points <= 100000),
    registration_deadline TIMESTAMP WITH TIME ZONE NOT NULL,
    prize                 VARCHAR(120) NOT NULL,
    poster_color          VARCHAR(7)   NOT NULL,
    poster_initial        VARCHAR(8)   NOT NULL DEFAULT '',
    status                VARCHAR(16)  NOT NULL DEFAULT 'scheduled'
                            CHECK (status IN ('scheduled','open','closed','cancelled')),
    series_id             INTEGER      REFERENCES public.event_series(id) ON DELETE SET NULL,
    registered_count      INTEGER      NOT NULL DEFAULT 0 CHECK (registered_count >= 0),
    created_by            INTEGER      NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    cancelled_at          TIMESTAMP WITH TIME ZONE,
    cancel_reason         TEXT,
    CONSTRAINT events_opens_closes_check CHECK (opens_at < closes_at)
);

CREATE INDEX idx_events_opens_at      ON public.events USING btree (opens_at);
CREATE INDEX idx_events_status        ON public.events USING btree (status);
CREATE INDEX idx_events_venue_id      ON public.events USING btree (venue_id);
CREATE INDEX idx_events_series_id     ON public.events USING btree (series_id);
CREATE INDEX idx_events_category      ON public.events USING btree (category);

-- ─── 이벤트 신청(EventRegistration) ─────────────────────────────────────────────

CREATE TABLE public.event_registrations (
    id              SERIAL PRIMARY KEY,
    event_id        INTEGER      NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
    user_id         INTEGER      NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    points_paid     INTEGER      NOT NULL DEFAULT 0 CHECK (points_paid >= 0),
    registered_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','entered','ticketed','missed','no_show','cancelled','refunded')),
    ticket_id       INTEGER,   -- tickets 테이블 FK (ticketed 상태일 때만 채움)
    cancelled_at    TIMESTAMP WITH TIME ZONE,
    refunded_at     TIMESTAMP WITH TIME ZONE,
    refund_points   INTEGER CHECK (refund_points >= 0)
);

-- 유저당 이벤트 1건 신청만 허용 (pending/entered/ticketed/missed/no_show 상태)
CREATE UNIQUE INDEX uq_event_reg_user_event_active
    ON public.event_registrations (event_id, user_id)
    WHERE status IN ('pending','entered','ticketed','missed','no_show');

CREATE INDEX idx_event_reg_event      ON public.event_registrations USING btree (event_id);
CREATE INDEX idx_event_reg_user       ON public.event_registrations USING btree (user_id);
CREATE INDEX idx_event_reg_status     ON public.event_registrations USING btree (status);
CREATE INDEX idx_event_reg_registered ON public.event_registrations USING btree (registered_at DESC);

-- ─── 유저 포인트 잔액 컬럼 추가 (users 테이블에 없다면) ──────────────────────────

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0);
