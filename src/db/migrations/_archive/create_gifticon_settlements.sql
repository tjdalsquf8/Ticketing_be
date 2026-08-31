-- 정산 이력(기프티콘): 유료 이벤트 TOP3 티켓(tickets.rank <= 3)에 지급된 기프티콘 기록.
-- pending 상태는 이 테이블에 행이 없는 것으로 표현한다 (issued 시에만 INSERT).
CREATE TABLE public.gifticon_settlements (
    id integer NOT NULL,
    ticket_id integer NOT NULL,
    gifticon_id integer NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gifticon_settlements_ticket_id_key UNIQUE (ticket_id),
    CONSTRAINT gifticon_settlements_gifticon_id_key UNIQUE (gifticon_id)
);

CREATE SEQUENCE public.gifticon_settlements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.gifticon_settlements_id_seq OWNED BY public.gifticon_settlements.id;

ALTER TABLE ONLY public.gifticon_settlements
    ALTER COLUMN id SET DEFAULT nextval('public.gifticon_settlements_id_seq'::regclass);

ALTER TABLE ONLY public.gifticon_settlements
    ADD CONSTRAINT gifticon_settlements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.gifticon_settlements
    ADD CONSTRAINT gifticon_settlements_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.gifticon_settlements
    ADD CONSTRAINT gifticon_settlements_gifticon_id_fkey FOREIGN KEY (gifticon_id) REFERENCES public.gifticons(id) ON DELETE RESTRICT;
