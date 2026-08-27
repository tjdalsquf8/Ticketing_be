-- venues 시드 데이터 10개 삽입
-- slug NOT NULL 제약 적용 (seed 완료 후)

INSERT INTO public.venues (name, layout, total_seats, thumbnail_url, slug) VALUES
  ('KSPO돔 (올림픽공원 체조경기장)', 'arena-ring',   1800, '/Img/live/kspo-dome.png',          'kspo-dome-v1'),
  ('고척스카이돔',                   'baseball',     1620, '/Img/live/gocheok-skydome.png',    'gocheok-skydome-v1'),
  ('잠실 야구장',                    'baseball',     1560, '/Img/live/jamsil-baseball.png',    'jamsil-baseball-v1'),
  ('인천 SSG랜더스필드',             'baseball',     1500, '/Img/live/ssg-landers.png',         'ssg-landers-v1'),
  ('인스파이어 아레나',              'arena-ring',    840, '/Img/live/inspire-arena.png',       'inspire-arena-v1'),
  ('잠실 종합운동장 주경기장',       'stadium-oval', 1560, '/Img/live/jamsil-olympic-main.png', 'jamsil-olympic-main-v1'),
  ('블루스퀘어 대극장',              'proscenium',    690, '/Img/live/bluesquare.png',          'bluesquare-main-v1'),
  ('세종문화회관 대극장',            'proscenium',    990, '/Img/live/sejong-grand.png',        'sejong-grand-v1'),
  ('YES24 라이브홀',                 'proscenium',    270, '/Img/live/yes24-livehall.png',      'yes24-livehall-v1'),
  ('한강 페스티벌 필드',             'festival',      300, '/Img/live/hangang-festival.png',    'hangang-festival-v1');

-- slug NOT NULL 제약 적용 (시드 완료 후 확정)
ALTER TABLE public.venues
  ALTER COLUMN slug SET NOT NULL;
