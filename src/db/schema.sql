--
-- PostgreSQL database dump
--

\restrict jW0itaSH1Q8EbhcaHBlHVhF5TmFtPghfw3V7mscJhZOZoJfDRaZSwVzEWcXTxa4

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
-- Name: live_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_config (
    id smallint DEFAULT 1 NOT NULL,
    default_event_id integer NOT NULL,
    default_seat_labels jsonb NOT NULL,
    updated_by integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    excluded_hours integer[] DEFAULT ARRAY[]::integer[] NOT NULL,
    CONSTRAINT live_config_id_check CHECK ((id = 1))
);


--
-- Name: live_holds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_holds (
    id integer NOT NULL,
    round_id integer NOT NULL,
    seat_id integer NOT NULL,
    actor_key character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
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
    event_id integer NOT NULL,
    seat_labels jsonb NOT NULL,
    status character varying(16) DEFAULT 'scheduled'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
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
    round_id integer NOT NULL,
    seat_label character varying(32) NOT NULL,
    status character varying(16) DEFAULT 'available'::character varying NOT NULL,
    sold_session_id character varying(32),
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
    round_id integer NOT NULL,
    user_id integer,
    guest_uuid character varying(36),
    nickname character varying(30) NOT NULL,
    seat_label character varying(32),
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    elapsed_ms integer,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    CONSTRAINT live_sessions_check CHECK (((user_id IS NOT NULL) OR (guest_uuid IS NOT NULL))),
    CONSTRAINT live_sessions_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])))
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
    round_id integer NOT NULL,
    event_id integer NOT NULL,
    passenger_nickname character varying(30) NOT NULL,
    serial character varying(32) NOT NULL,
    stub_no character varying(16),
    seat_label character varying(32) NOT NULL,
    elapsed_ms integer NOT NULL,
    rank smallint NOT NULL,
    total_participants integer NOT NULL,
    qr_payload character varying(200) NOT NULL,
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
    refresh_token character varying(500),
    role character varying(16) DEFAULT 'user'::character varying NOT NULL,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['user'::character varying, 'admin'::character varying])::text[])))
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
-- Name: idx_live_seats_round_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_seats_round_status ON public.live_seats USING btree (round_id, status);


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
-- Name: live_config live_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_config
    ADD CONSTRAINT live_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


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
-- Name: live_seats live_seats_round_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_seats
    ADD CONSTRAINT live_seats_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.live_rounds(id) ON DELETE CASCADE;


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

\unrestrict jW0itaSH1Q8EbhcaHBlHVhF5TmFtPghfw3V7mscJhZOZoJfDRaZSwVzEWcXTxa4

