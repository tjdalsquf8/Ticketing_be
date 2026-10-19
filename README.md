# TICKET RUSH — Backend

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white"/>
  <img src="https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white"/>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white"/>
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white"/>
  <img src="https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white"/>
  <img src="https://img.shields.io/badge/Jest-C21325?style=flat-square&logo=jest&logoColor=white"/>
  <img src="https://img.shields.io/badge/k6-7D64FF?style=flat-square&logo=k6&logoColor=white"/>
</p>

> 프론트엔드 저장소: [Ticketing_fe](https://github.com/tjdalsquf8/Ticketing_fe)

---

## 서비스 소개

실전과 똑같은 좌석 선택·대기열·좌석 점유 흐름을 연습하고, 매 정각 열리는 **무료 실시간 티켓팅**에서 속도를 겨루는 티켓팅 트레이닝 서비스의 API 서버. 1인 개발.

| 기존 방식 | TICKET RUSH 사용 후 |
|---|---|
| 티켓팅은 실전 한 번뿐이라 연습할 방법이 없음 | 연습 세션 API로 실전과 동일한 흐름을 무료 체험 |
| 접속이 몰리면 순번이 꼬이고 정원을 넘겨 입장 | Redis Lua 스크립트로 순번 발급·정원 확인을 원자적으로 처리 |
| 같은 좌석을 동시에 잡아 중복 예매 발생 | 좌석 점유(hold)를 Redis TTL로 관리, 확정은 Postgres 트랜잭션 |
| 클릭 속도 비교 기준 없음 | 소요 시간 기반 연습/실시간 랭킹 집계 API |

---

## 화면 소개

이 저장소는 API 서버라 별도 화면이 없습니다. 화면은 [프론트엔드 README](https://github.com/tjdalsquf8/Ticketing_fe#화면-소개)에서 볼 수 있고, 실시간 티켓팅 한 회차는 아래 흐름으로 API를 호출합니다.

| 단계 | 화면 | API |
|---|---|---|
| 1. 오픈 대기 | 카운트다운 | `GET /api/time`, `GET /api/live/next` |
| 2. 대기실 | 대기 순번 표시 | `POST /api/live/rounds/:roundId/sessions`, `GET .../queue/stream` (SSE) |
| 3. 좌석 선택 | 좌석 맵 | `GET .../seats/stream` (SSE), `POST /api/live/sessions/:sessionId/hold` |
| 4. 구매 확정 | 결과 · 랭킹 | `POST /api/live/sessions/:sessionId/confirm` → `GET /api/live/rounds/:roundId/rankings` |

---

## 주요 기능

- **실시간 티켓팅 엔진** — 매 정각 회차 자동 생성·오픈·종료(node-cron), 대기열(ZSET) → 활성 세션(정원 제한) → 좌석 hold → 확정
- **동시성 제어** — 순번 발급(`INCR`+`ZADD`)과 정원 확인(`SCARD`+`SADD`)을 Lua 스크립트로 원자화. 좌석 hold는 Redis 키 TTL(기본 30초)로 자동 해제하고, 판매 완료만 Postgres `live_seats`에 영구 기록
- **SSE 스트림** — 대기열 순번 변화·좌석 점유/해제를 실시간 푸시
- **방치 세션 정리 · Redis 장애 대응** — heartbeat 없는 세션 자동 실패 처리, Redis 연결이 끊기면 라이브 API를 503으로 즉시 거절(`requireRedis`, fail-fast)하고 Redis는 AOF(`appendonly`)로 영속화
- **연습 모드 · 랭킹** — 연습 세션 시작/완료, 소요 시간·등수·백분위 계산, 일·주·월 랭킹, 내 순위 조회
- **이벤트 · 공지 · 통계** — 이벤트 등록·참여 신청·스케줄러, 공지사항 CRUD, 홈 일일 통계
- **관리자 API** — 라이브 회차·설정, 이벤트·시리즈, 기프티콘 재고, 정산 이력(TOP 당첨자 지급 상태)
- **인증** — bcrypt + JWT(httpOnly 쿠키), refresh 토큰 sha256 해시 저장·로테이션·재사용 감지, 가입 없이 쓰는 게스트 UUID 쿠키
- **보안 · 어뷰징 방지** — helmet, hpp, CORS 화이트리스트, JSON Content-Type 강제, express-validator 입력 검증, 엔드포인트별 Rate Limiting(로그인 15분 5회 등)
- **테스트** — Jest + supertest 통합 테스트(인증·라이브·이벤트·랭킹·정산 등), k6 부하 테스트 스크립트(`load-test/`)

---

## 기술 스택

| 분류 | 기술 |
|---|---|
| Language | TypeScript |
| Framework | Node.js, Express 5 |
| Database | PostgreSQL (`pg` 직접 쿼리), 스키마 단일 소스 `src/db/schema.sql` |
| Cache / 실시간 | Redis 7 (ioredis) — 대기열·좌석 점유·세션, SSE |
| 인증 | bcrypt, JWT, httpOnly 쿠키 |
| 검증 / 보안 | express-validator, helmet, hpp, express-rate-limit, cors |
| 스케줄러 | node-cron |
| 테스트 | Jest, supertest, @swc/jest, k6 |
| 인프라 | Docker Compose (로컬 Redis) |

---

## 아키텍처

```
[Next.js — Ticketing_fe]
    │  REST + SSE
    ▼
[Express API]
    routes → middlewares(validator · auth · rate limit) → controllers → services
    │
    ├── [PostgreSQL]   ← 회원 · 회차 · 좌석(판매 확정) · 세션 결과 · 이벤트 · 기프티콘
    └── [Redis]        ← 대기열(ZSET) · 활성 세션(Set) · 좌석 hold(TTL) · 세션 Hash

[node-cron]  회차 생성/전환/종료 · 이벤트 스케줄 · 방치 세션 정리 · 종료 이벤트 숨김
```

- 계층 규칙: controller는 SQL을 직접 쓰지 않고 services에 위임
- 진행 중 세션은 Redis만이 저장소이고, 구매 확정 시점에만 Postgres에 기록

---

## 폴더 구조

```
BE/
├── src/
│   ├── routes/        엔드포인트 정의 (/api/auth · live · events · practice · rankings · admin ...)
│   ├── middlewares/   인증 · rate limit · 에러 핸들러 · requireRedis · validators/
│   ├── controllers/   요청/응답 처리
│   ├── services/      비즈니스 로직 (live_*.redis.ts — Redis 대기열·좌석·세션)
│   ├── events/        SSE용 프로세스 내 이벤트 버스
│   ├── jobs/          cron (회차·이벤트 스케줄러, 세션 정리)
│   ├── config/        환경변수 · db · redis
│   ├── db/            schema.sql · migrations/
│   └── __tests__/     Jest + supertest
├── load-test/         k6 부하 테스트 (스윕 실행 · 결과 CSV 기록)
├── docker-compose.yml 로컬 Redis
```
