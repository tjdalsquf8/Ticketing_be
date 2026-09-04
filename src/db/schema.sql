--
-- PostgreSQL database dump
--

\restrict fvcfZbZ3ZjQJ5cPt1rXWGRVzUckfo4NK4RmMkpyNVB2pHrtUCGCMVkZxkQJQR3z

-- Dumped from database version 16.13 (Postgres.app)
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: event_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_registrations (
    id integer NOT NULL,
    event_id integer NOT NULL,
    user_id integer NOT NULL,
    tickets_paid integer DEFAULT 0 NOT NULL,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    ticket_id integer,
    cancelled_at timestamp with time zone,
    refunded_at timestamp with time zone,
    refund_tickets integer,
    CONSTRAINT event_registrations_refund_tickets_check CHECK ((refund_tickets >= 0)),
    CONSTRAINT event_registrations_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'entered'::character varying, 'ticketed'::character varying, 'missed'::character varying, 'no_show'::character varying, 'cancelled'::character varying, 'refunded'::character varying])::text[]))),
    CONSTRAINT event_registrations_tickets_paid_check CHECK ((tickets_paid >= 0))
);


--
-- Name: event_registrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_registrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_registrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_registrations_id_seq OWNED BY public.event_registrations.id;


--
-- Name: event_series; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_series (
    id integer NOT NULL,
    title character varying(80) NOT NULL,
    category character varying(20) NOT NULL,
    venue_id integer NOT NULL,
    duration_ms integer DEFAULT 300000 NOT NULL,
    entry_fee_tickets integer DEFAULT 500 NOT NULL,
    prize character varying(120) NOT NULL,
    poster_color character varying(7) NOT NULL,
    poster_initial character varying(8) DEFAULT ''::character varying NOT NULL,
    recurrence jsonb NOT NULL,
    created_by integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_series_category_check CHECK (((category)::text = ANY ((ARRAY['concert'::character varying, 'musical'::character varying, 'sports'::character varying, 'theater'::character varying, 'festival'::character varying])::text[]))),
    CONSTRAINT event_series_entry_fee_tickets_check CHECK (((entry_fee_tickets >= 0) AND (entry_fee_tickets <= 100000)))
);


--
-- Name: event_series_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_series_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_series_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_series_id_seq OWNED BY public.event_series.id;


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id integer NOT NULL,
    type character varying(10) DEFAULT 'paid'::character varying NOT NULL,
    category character varying(20) NOT NULL,
    title character varying(80) NOT NULL,
    venue_id integer NOT NULL,
    total_seats integer NOT NULL,
    opens_at timestamp with time zone NOT NULL,
    closes_at timestamp with time zone NOT NULL,
    duration_ms integer DEFAULT 300000 NOT NULL,
    entry_fee_tickets integer DEFAULT 500 NOT NULL,
    registration_deadline timestamp with time zone NOT NULL,
    prize character varying(120) NOT NULL,
    poster_color character varying(7) NOT NULL,
    poster_initial character varying(8) DEFAULT ''::character varying NOT NULL,
    status character varying(16) DEFAULT 'scheduled'::character varying NOT NULL,
    series_id integer,
    registered_count integer DEFAULT 0 NOT NULL,
    created_by integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    hidden_at timestamp with time zone,
    CONSTRAINT events_category_check CHECK (((category)::text = ANY ((ARRAY['concert'::character varying, 'musical'::character varying, 'sports'::character varying, 'theater'::character varying, 'festival'::character varying])::text[]))),
    CONSTRAINT events_entry_fee_tickets_check CHECK (((entry_fee_tickets >= 0) AND (entry_fee_tickets <= 100000))),
    CONSTRAINT events_opens_closes_check CHECK ((opens_at < closes_at)),
    CONSTRAINT events_registered_count_check CHECK ((registered_count >= 0)),
    CONSTRAINT events_status_check CHECK (((status)::text = ANY ((ARRAY['scheduled'::character varying, 'open'::character varying, 'closed'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT events_total_seats_check CHECK ((total_seats > 0)),
    CONSTRAINT events_type_check CHECK (((type)::text = 'paid'::text))
);


--
-- Name: events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.events_id_seq OWNED BY public.events.id;


--
-- Name: gifticon_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gifticon_settlements (
    id integer NOT NULL,
    ticket_id integer NOT NULL,
    gifticon_id integer NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gifticon_settlements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gifticon_settlements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gifticon_settlements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gifticon_settlements_id_seq OWNED BY public.gifticon_settlements.id;


--
-- Name: gifticon_view_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gifticon_view_logs (
    id integer NOT NULL,
    gifticon_id integer,
    viewed_by integer NOT NULL,
    viewed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gifticon_view_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gifticon_view_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gifticon_view_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gifticon_view_logs_id_seq OWNED BY public.gifticon_view_logs.id;


--
-- Name: gifticons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gifticons (
    id integer NOT NULL,
    category character varying(20) NOT NULL,
    product_name character varying(80) NOT NULL,
    face_value integer NOT NULL,
    code character varying(64) NOT NULL,
    status character varying(16) DEFAULT 'available'::character varying NOT NULL,
    created_by integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gifticons_category_check CHECK (((category)::text = ANY ((ARRAY['coffee'::character varying, 'food'::character varying, 'convenience'::character varying, 'beauty'::character varying, 'etc'::character varying])::text[]))),
    CONSTRAINT gifticons_face_value_check CHECK ((face_value > 0)),
    CONSTRAINT gifticons_status_check CHECK (((status)::text = ANY ((ARRAY['available'::character varying, 'issued'::character varying, 'redeemed'::character varying, 'expired'::character varying])::text[])))
);


--
-- Name: gifticons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gifticons_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gifticons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gifticons_id_seq OWNED BY public.gifticons.id;


--
-- Name: guests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guests (
    id integer NOT NULL,
    guest_uuid character varying(36) NOT NULL,
    nickname character varying(30) DEFAULT '익명유저'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    nickname_changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: guests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.guests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: guests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.guests_id_seq OWNED BY public.guests.id;


--
-- Name: live_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_config (
    id smallint DEFAULT 1 NOT NULL,
    default_seat_labels jsonb NOT NULL,
    updated_by integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    excluded_hours integer[] DEFAULT ARRAY[]::integer[] NOT NULL,
    default_venue_id integer NOT NULL,
    CONSTRAINT live_config_id_check CHECK ((id = 1))
);


--
-- Name: live_holds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_holds (
    id integer NOT NULL,
    round_id integer,
    seat_id integer NOT NULL,
    actor_key character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    event_id integer,
    CONSTRAINT live_holds_context_check CHECK (((round_id IS NOT NULL) OR (event_id IS NOT NULL)))
);


--
-- Name: live_holds_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.live_holds_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: live_holds_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.live_holds_id_seq OWNED BY public.live_holds.id;


--
-- Name: live_rounds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_rounds (
    id integer NOT NULL,
    opens_at timestamp with time zone NOT NULL,
    closes_at timestamp with time zone NOT NULL,
    seat_labels jsonb NOT NULL,
    status character varying(16) DEFAULT 'scheduled'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    venue_id integer NOT NULL,
    CONSTRAINT live_rounds_check CHECK ((opens_at < closes_at)),
    CONSTRAINT live_rounds_status_check CHECK (((status)::text = ANY ((ARRAY['scheduled'::character varying, 'open'::character varying, 'closed'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: live_rounds_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.live_rounds_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: live_rounds_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.live_rounds_id_seq OWNED BY public.live_rounds.id;


--
-- Name: live_seats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_seats (
    id integer NOT NULL,
    round_id integer,
    seat_label character varying(32) NOT NULL,
    status character varying(16) DEFAULT 'available'::character varying NOT NULL,
    sold_session_id character varying(32),
    event_id integer,
    CONSTRAINT live_seats_context_check CHECK (((round_id IS NOT NULL) OR (event_id IS NOT NULL))),
    CONSTRAINT live_seats_status_check CHECK (((status)::text = ANY ((ARRAY['available'::character varying, 'held'::character varying, 'sold'::character varying])::text[])))
);


--
-- Name: live_seats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.live_seats_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: live_seats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.live_seats_id_seq OWNED BY public.live_seats.id;


--
-- Name: live_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_sessions (
    id integer NOT NULL,
    session_id character varying(20) NOT NULL,
    round_id integer,
    user_id integer,
    guest_uuid character varying(36),
    nickname character varying(30) NOT NULL,
    seat_label character varying(32),
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    elapsed_ms integer,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    queue_position integer,
    event_id integer,
    CONSTRAINT live_sessions_check CHECK (((user_id IS NOT NULL) OR (guest_uuid IS NOT NULL))),
    CONSTRAINT live_sessions_context_check CHECK (((round_id IS NOT NULL) OR (event_id IS NOT NULL))),
    CONSTRAINT live_sessions_status_check CHECK (((status)::text = ANY (ARRAY['queued'::text, 'active'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: live_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.live_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: live_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.live_sessions_id_seq OWNED BY public.live_sessions.id;


--
-- Name: live_waiting; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_waiting (
    id integer NOT NULL,
    round_id integer NOT NULL,
    actor_key character varying(64) NOT NULL,
    entered_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: live_waiting_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.live_waiting_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: live_waiting_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.live_waiting_id_seq OWNED BY public.live_waiting.id;


--
-- Name: notices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notices (
    id integer NOT NULL,
    kind character varying(16) NOT NULL,
    title character varying(120) NOT NULL,
    href character varying(500),
    created_by integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    content text,
    CONSTRAINT notices_kind_check CHECK (((kind)::text = ANY ((ARRAY['notice'::character varying, 'update'::character varying, 'fix'::character varying])::text[])))
);


--
-- Name: notices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notices_id_seq OWNED BY public.notices.id;


--
-- Name: practice_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_sessions (
    id integer NOT NULL,
    session_id character varying(20) NOT NULL,
    user_id integer,
    guest_uuid character varying(36),
    nickname character varying(30) NOT NULL,
    mode character varying(10) NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    elapsed_ms integer,
    event_id integer,
    ranking_eligible boolean DEFAULT true NOT NULL,
    CONSTRAINT practice_sessions_mode_check CHECK (((mode)::text = ANY ((ARRAY['practice'::character varying, 'live'::character varying])::text[])))
);


--
-- Name: practice_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.practice_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: practice_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.practice_sessions_id_seq OWNED BY public.practice_sessions.id;


--
-- Name: tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tickets (
    id integer NOT NULL,
    live_session_id integer NOT NULL,
    user_id integer NOT NULL,
    round_id integer,
    event_id integer,
    passenger_nickname character varying(30) NOT NULL,
    serial character varying(32) NOT NULL,
    stub_no character varying(16),
    seat_label character varying(32) NOT NULL,
    elapsed_ms integer NOT NULL,
    rank smallint NOT NULL,
    total_participants integer NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tickets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tickets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tickets_id_seq OWNED BY public.tickets.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    password character varying(255) NOT NULL,
    name character varying(100) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    refresh_token_hash character(64),
    role character varying(16) DEFAULT 'user'::character varying NOT NULL,
    tickets integer DEFAULT 0 NOT NULL,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['user'::character varying, 'admin'::character varying])::text[]))),
    CONSTRAINT users_tickets_check CHECK ((tickets >= 0))
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: venues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venues (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    layout character varying(50) NOT NULL,
    total_seats integer NOT NULL,
    thumbnail_url character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    slug character varying(50) NOT NULL,
    CONSTRAINT venues_layout_check CHECK (((layout)::text = ANY ((ARRAY['arena-ring'::character varying, 'baseball'::character varying, 'stadium-oval'::character varying, 'proscenium'::character varying, 'festival'::character varying, 'auditorium'::character varying])::text[]))),
    CONSTRAINT venues_total_seats_check CHECK ((total_seats > 0))
);


--
-- Name: venues_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.venues_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: venues_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.venues_id_seq OWNED BY public.venues.id;


--
-- Name: event_registrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registrations ALTER COLUMN id SET DEFAULT nextval('public.event_registrations_id_seq'::regclass);


--
-- Name: event_series id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_series ALTER COLUMN id SET DEFAULT nextval('public.event_series_id_seq'::regclass);


--
-- Name: events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events ALTER COLUMN id SET DEFAULT nextval('public.events_id_seq'::regclass);


--
-- Name: gifticon_settlements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifticon_settlements ALTER COLUMN id SET DEFAULT nextval('public.gifticon_settlements_id_seq'::regclass);


--
-- Name: gifticon_view_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifticon_view_logs ALTER COLUMN id SET DEFAULT nextval('public.gifticon_view_logs_id_seq'::regclass);


--
-- Name: gifticons id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifticons ALTER COLUMN id SET DEFAULT nextval('public.gifticons_id_seq'::regclass);


--
-- Name: guests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guests ALTER COLUMN id SET DEFAULT nextval('public.guests_id_seq'::regclass);


--
-- Name: live_holds id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_holds ALTER COLUMN id SET DEFAULT nextval('public.live_holds_id_seq'::regclass);


--
-- Name: live_rounds id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_rounds ALTER COLUMN id SET DEFAULT nextval('public.live_rounds_id_seq'::regclass);


--
-- Name: live_seats id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_seats ALTER COLUMN id SET DEFAULT nextval('public.live_seats_id_seq'::regclass);


--
-- Name: live_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_sessions ALTER COLUMN id SET DEFAULT nextval('public.live_sessions_id_seq'::regclass);


--
-- Name: live_waiting id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_waiting ALTER COLUMN id SET DEFAULT nextval('public.live_waiting_id_seq'::regclass);


--
-- Name: notices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notices ALTER COLUMN id SET DEFAULT nextval('public.notices_id_seq'::regclass);


--
-- Name: practice_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions ALTER COLUMN id SET DEFAULT nextval('public.practice_sessions_id_seq'::regclass);


--
-- Name: tickets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets ALTER COLUMN id SET DEFAULT nextval('public.tickets_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: venues id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venues ALTER COLUMN id SET DEFAULT nextval('public.venues_id_seq'::regclass);


--
-- Name: event_registrations event_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_pkey PRIMARY KEY (id);


--
-- Name: event_series event_series_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_series
    ADD CONSTRAINT event_series_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: gifticon_settlements gifticon_settlements_gifticon_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifticon_settlements
    ADD CONSTRAINT gifticon_settlements_gifticon_id_key UNIQUE (gifticon_id);


--
-- Name: gifticon_settlements gifticon_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifticon_settlements
    ADD CONSTRAINT gifticon_settlements_pkey PRIMARY KEY (id);


--
-- Name: gifticon_settlements gifticon_settlements_ticket_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifticon_settlements
    ADD CONSTRAINT gifticon_settlements_ticket_id_key UNIQUE (ticket_id);


--
-- Name: gifticon_view_logs gifticon_view_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifticon_view_logs
    ADD CONSTRAINT gifticon_view_logs_pkey PRIMARY KEY (id);


--
-- Name: gifticons gifticons_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifticons
    ADD CONSTRAINT gifticons_code_key UNIQUE (code);


--
-- Name: gifticons gifticons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifticons
    ADD CONSTRAINT gifticons_pkey PRIMARY KEY (id);


--
-- Name: guests guests_guest_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guests
    ADD CONSTRAINT guests_guest_uuid_key UNIQUE (guest_uuid);


--
-- Name: guests guests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guests
    ADD CONSTRAINT guests_pkey PRIMARY KEY (id);


--
-- Name: live_config live_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_config
    ADD CONSTRAINT live_config_pkey PRIMARY KEY (id);


--
-- Name: live_holds live_holds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_holds
    ADD CONSTRAINT live_holds_pkey PRIMARY KEY (id);


--
-- Name: live_holds live_holds_round_id_actor_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_holds
    ADD CONSTRAINT live_holds_round_id_actor_key_key UNIQUE (round_id, actor_key);


--
-- Name: live_holds live_holds_round_id_seat_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_holds
    ADD CONSTRAINT live_holds_round_id_seat_id_key UNIQUE (round_id, seat_id);


--
-- Name: live_rounds live_rounds_opens_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_rounds
    ADD CONSTRAINT live_rounds_opens_at_key UNIQUE (opens_at);


--
-- Name: live_rounds live_rounds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_rounds
    ADD CONSTRAINT live_rounds_pkey PRIMARY KEY (id);


--
-- Name: live_seats live_seats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_seats
    ADD CONSTRAINT live_seats_pkey PRIMARY KEY (id);


--
-- Name: live_seats live_seats_round_id_seat_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_seats
    ADD CONSTRAINT live_seats_round_id_seat_label_key UNIQUE (round_id, seat_label);


--
-- Name: live_sessions live_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_sessions
    ADD CONSTRAINT live_sessions_pkey PRIMARY KEY (id);


--
-- Name: live_sessions live_sessions_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_sessions
    ADD CONSTRAINT live_sessions_session_id_key UNIQUE (session_id);


--
-- Name: live_waiting live_waiting_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_waiting
    ADD CONSTRAINT live_waiting_pkey PRIMARY KEY (id);


--
-- Name: live_waiting live_waiting_round_id_actor_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_waiting
    ADD CONSTRAINT live_waiting_round_id_actor_key_key UNIQUE (round_id, actor_key);


--
-- Name: notices notices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notices
    ADD CONSTRAINT notices_pkey PRIMARY KEY (id);


--
-- Name: practice_sessions practice_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_pkey PRIMARY KEY (id);


--
-- Name: practice_sessions practice_sessions_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_session_id_key UNIQUE (session_id);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);


--
-- Name: tickets tickets_serial_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_serial_key UNIQUE (serial);


--
-- Name: tickets uq_tickets_round_rank; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT uq_tickets_round_rank UNIQUE (round_id, rank);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: venues venues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venues
    ADD CONSTRAINT venues_pkey PRIMARY KEY (id);


--
-- Name: venues venues_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venues
    ADD CONSTRAINT venues_slug_key UNIQUE (slug);


--
-- Name: idx_event_reg_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_reg_event ON public.event_registrations USING btree (event_id);


--
-- Name: idx_event_reg_registered; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_reg_registered ON public.event_registrations USING btree (registered_at DESC);


--
-- Name: idx_event_reg_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_reg_status ON public.event_registrations USING btree (status);


--
-- Name: idx_event_reg_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_reg_user ON public.event_registrations USING btree (user_id);


--
-- Name: idx_event_series_venue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_series_venue ON public.event_series USING btree (venue_id);


--
-- Name: idx_events_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_category ON public.events USING btree (category);


--
-- Name: idx_events_hidden_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_hidden_at ON public.events USING btree (hidden_at);


--
-- Name: idx_events_opens_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_opens_at ON public.events USING btree (opens_at);


--
-- Name: idx_events_series_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_series_id ON public.events USING btree (series_id);


--
-- Name: idx_events_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_status ON public.events USING btree (status);


--
-- Name: idx_events_status_hidden_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_status_hidden_at ON public.events USING btree (status, hidden_at);


--
-- Name: idx_events_venue_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_venue_id ON public.events USING btree (venue_id);


--
-- Name: idx_gifticon_view_logs_gifticon_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gifticon_view_logs_gifticon_id ON public.gifticon_view_logs USING btree (gifticon_id);


--
-- Name: idx_gifticons_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gifticons_category ON public.gifticons USING btree (category);


--
-- Name: idx_gifticons_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gifticons_status ON public.gifticons USING btree (status);


--
-- Name: idx_guests_guest_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guests_guest_uuid ON public.guests USING btree (guest_uuid);


--
-- Name: idx_live_holds_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_holds_expires_at ON public.live_holds USING btree (expires_at);


--
-- Name: idx_live_rounds_opens_at_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_rounds_opens_at_desc ON public.live_rounds USING btree (opens_at DESC);


--
-- Name: idx_live_rounds_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_rounds_status ON public.live_rounds USING btree (status);


--
-- Name: idx_live_rounds_venue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_rounds_venue ON public.live_rounds USING btree (venue_id);


--
-- Name: idx_live_seats_round_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_seats_round_status ON public.live_seats USING btree (round_id, status);


--
-- Name: idx_live_sessions_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_sessions_event_id ON public.live_sessions USING btree (event_id);


--
-- Name: idx_live_sessions_round_elapsed_completed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_sessions_round_elapsed_completed ON public.live_sessions USING btree (round_id, elapsed_ms) WHERE ((status)::text = 'completed'::text);


--
-- Name: idx_live_sessions_round_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_sessions_round_status ON public.live_sessions USING btree (round_id, status);


--
-- Name: idx_live_waiting_round; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_waiting_round ON public.live_waiting USING btree (round_id);


--
-- Name: idx_notices_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notices_created_at ON public.notices USING btree (created_at DESC);


--
-- Name: idx_tickets_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_event ON public.tickets USING btree (event_id) WHERE (round_id IS NULL);


--
-- Name: idx_tickets_round; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_round ON public.tickets USING btree (round_id);


--
-- Name: idx_tickets_user_issued; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_user_issued ON public.tickets USING btree (user_id, issued_at DESC);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_venues_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venues_name ON public.venues USING btree (name);


--
-- Name: idx_venues_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venues_slug ON public.venues USING btree (slug);


--
-- Name: uq_event_reg_user_event_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_event_reg_user_event_active ON public.event_registrations USING btree (event_id, user_id) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'entered'::character varying, 'ticketed'::character varying, 'missed'::character varying, 'no_show'::character varying])::text[]));


--
-- Name: uq_live_holds_event_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_live_holds_event_actor ON public.live_holds USING btree (event_id, actor_key) WHERE (event_id IS NOT NULL);


--
-- Name: uq_live_seats_event_label; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_live_seats_event_label ON public.live_seats USING btree (event_id, seat_label) WHERE (event_id IS NOT NULL);


--
-- Name: uq_live_sessions_round_guest_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_live_sessions_round_guest_active ON public.live_sessions USING btree (round_id, guest_uuid) WHERE ((guest_uuid IS NOT NULL) AND ((status)::text = ANY ((ARRAY['queued'::character varying, 'active'::character varying, 'completed'::character varying])::text[])));


--
-- Name: uq_live_sessions_round_nickname_guest; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_live_sessions_round_nickname_guest ON public.live_sessions USING btree (round_id, nickname) WHERE ((guest_uuid IS NOT NULL) AND ((status)::text = ANY ((ARRAY['queued'::character varying, 'active'::character varying, 'completed'::character varying])::text[])));


--
-- Name: uq_live_sessions_round_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_live_sessions_round_user_active ON public.live_sessions USING btree (round_id, user_id) WHERE ((user_id IS NOT NULL) AND ((status)::text = ANY ((ARRAY['queued'::character varying, 'active'::character varying, 'completed'::character varying])::text[])));


--
-- Name: uq_tickets_event_rank; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_tickets_event_rank ON public.tickets USING btree (event_id, rank) WHERE (round_id IS NULL);


--
-- Name: event_registrations event_registrations_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT;


--
-- Name: event_registrations event_registrations_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE RESTRICT;


--
-- Name: event_registrations event_registrations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registrations
    ADD CONSTRAINT event_registrations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: event_series event_series_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_series
    ADD CONSTRAINT event_series_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: event_series event_series_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_series
    ADD CONSTRAINT event_series_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE RESTRICT;


--
-- Name: events events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: events events_series_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_series_id_fkey FOREIGN KEY (series_id) REFERENCES public.event_series(id) ON DELETE SET NULL;


--
-- Name: events events_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE RESTRICT;


--
-- Name: gifticon_settlements gifticon_settlements_gifticon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifticon_settlements
    ADD CONSTRAINT gifticon_settlements_gifticon_id_fkey FOREIGN KEY (gifticon_id) REFERENCES public.gifticons(id) ON DELETE RESTRICT;


--
-- Name: gifticon_settlements gifticon_settlements_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifticon_settlements
    ADD CONSTRAINT gifticon_settlements_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- Name: gifticon_view_logs gifticon_view_logs_gifticon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifticon_view_logs
    ADD CONSTRAINT gifticon_view_logs_gifticon_id_fkey FOREIGN KEY (gifticon_id) REFERENCES public.gifticons(id) ON DELETE SET NULL;


--
-- Name: gifticon_view_logs gifticon_view_logs_viewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifticon_view_logs
    ADD CONSTRAINT gifticon_view_logs_viewed_by_fkey FOREIGN KEY (viewed_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: gifticons gifticons_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gifticons
    ADD CONSTRAINT gifticons_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: live_config live_config_default_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_config
    ADD CONSTRAINT live_config_default_venue_id_fkey FOREIGN KEY (default_venue_id) REFERENCES public.venues(id) ON DELETE RESTRICT;


--
-- Name: live_config live_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_config
    ADD CONSTRAINT live_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: live_holds live_holds_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_holds
    ADD CONSTRAINT live_holds_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT;


--
-- Name: live_holds live_holds_round_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_holds
    ADD CONSTRAINT live_holds_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.live_rounds(id) ON DELETE CASCADE;


--
-- Name: live_holds live_holds_seat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_holds
    ADD CONSTRAINT live_holds_seat_id_fkey FOREIGN KEY (seat_id) REFERENCES public.live_seats(id) ON DELETE CASCADE;


--
-- Name: live_rounds live_rounds_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_rounds
    ADD CONSTRAINT live_rounds_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE RESTRICT;


--
-- Name: live_seats live_seats_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_seats
    ADD CONSTRAINT live_seats_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT;


--
-- Name: live_seats live_seats_round_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_seats
    ADD CONSTRAINT live_seats_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.live_rounds(id) ON DELETE CASCADE;


--
-- Name: live_sessions live_sessions_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_sessions
    ADD CONSTRAINT live_sessions_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE RESTRICT;


--
-- Name: live_sessions live_sessions_round_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_sessions
    ADD CONSTRAINT live_sessions_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.live_rounds(id) ON DELETE CASCADE;


--
-- Name: live_sessions live_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_sessions
    ADD CONSTRAINT live_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: live_waiting live_waiting_round_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_waiting
    ADD CONSTRAINT live_waiting_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.live_rounds(id) ON DELETE CASCADE;


--
-- Name: notices notices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notices
    ADD CONSTRAINT notices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: practice_sessions practice_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tickets tickets_live_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_live_session_id_fkey FOREIGN KEY (live_session_id) REFERENCES public.live_sessions(id) ON DELETE CASCADE;


--
-- Name: tickets tickets_round_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.live_rounds(id) ON DELETE CASCADE;


--
-- Name: tickets tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict fvcfZbZ3ZjQJ5cPt1rXWGRVzUckfo4NK4RmMkpyNVB2pHrtUCGCMVkZxkQJQR3z

