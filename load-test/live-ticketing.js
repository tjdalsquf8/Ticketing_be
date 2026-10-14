// 실시간 티켓팅 부하 테스트 (k6)
//
// 대상: 로컬 서버 (npm run dev, 기본 http://localhost:8081)
// 전제: live_rounds 에 status='open' 인 회차가 하나 이상 존재해야 한다.
//       없으면 관리자 계정으로 POST /api/admin/live/rounds/create-now 호출해 열어둘 것.
//       (README 참고)
//
// 실행:
//   BASE_URL=http://localhost:8081 k6 run load-test/live-ticketing.js
//   VUS=200 DURATION=30s k6 run load-test/live-ticketing.js   // 커스텀 부하
//   RAMPUP=5s VUS=1000 DURATION=25s BUY_RATE=0.2 k6 run load-test/live-ticketing.js
//     // BUY_RATE: 대기열 통과 후 실제 hold/confirm 을 시도할 VU 비율(0~1, 기본 1).
//     // 회차 좌석 수(보통 1620석)보다 VU 가 훨씬 많을 때 낮춰야
//     // 봇이 몇 초 안에 매진시키지 않고, 사람이 직접 예매 테스트할 여유가 생긴다.
//
// 대기열/좌석 조회는 REST 폴링에서 SSE 스트림(GET .../queue/stream, .../seats/stream)
// 으로 전환됐다. k6(이 버전엔 SSE/스트리밍 바디를 읽는 전용 API가 없음)는 진짜
// EventSource처럼 붙지 않고, 짧은 timeout 을 건 일반 GET 으로 "연결 즉시 첫 프레임만
// 받고 끊기"는 방식으로 흉내낸다 — 서버가 연결 직후 snapshot 이벤트를 곧바로 보내고,
// k6 는 타임아웃으로 요청이 "실패" 처리돼도 그 시점까지 받은 바디는 그대로 남겨주기
// 때문에 가능하다(firstSseFrame 참고). 그래서 이 스트림 호출들은 k6 관점에서 전부
// http_req_failed 로 잡히는 게 정상이고, 그 태그는 thresholds 에서 의도적으로 뺐다.
import http from "k6/http";
import { check, sleep, fail } from "k6";
import { Counter, Trend } from "k6/metrics";

/** SSE 응답 바디에서 첫 프레임(event/data) 하나만 파싱한다. 못 찾으면 null. */
function firstSseFrame(body) {
  if (!body) return null;
  const idx = body.indexOf("\n\n");
  const raw = idx === -1 ? body : body.slice(0, idx);
  const match = raw.match(/^event: (\w+)\ndata: (.+)$/);
  if (!match) return null;
  try {
    return { event: match[1], data: JSON.parse(match[2]) };
  } catch (e) {
    return null;
  }
}

const BASE_URL = __ENV.BASE_URL || "http://localhost:8081";
// 좌석 수는 회차당 고정(예: 1620석)인데 VU 수는 그보다 훨씬 크게 돌리는 경우가 많아,
// 전체 VU가 다 hold/confirm 까지 가면 몇 초 안에 매진돼 실사용자가 낄 틈이 없다.
// BUY_RATE 비율만큼만 실제 좌석 구매를 시도하고, 나머지는 대기열 통과 후 좌석은 보지 않고 종료
// (대기열 체감은 그대로 재현하면서 좌석 경쟁만 완화).
const BUY_RATE = Number(__ENV.BUY_RATE ?? 1);

// 시나리오별 지표를 따로 뽑아보기 위한 커스텀 메트릭
const seatWinCount = new Counter("seat_confirm_success"); // 좌석 확정 성공 수
const seatConflictCount = new Counter("seat_confirm_conflict"); // 409 정상 경합
const seatErrorCount = new Counter("seat_confirm_error"); // 그 외 비정상
const queueWaitTrend = new Trend("queue_wait_ms"); // 대기열 -> active 까지 걸린 시간 (ms)

export const options = {
  scenarios: {
    ticketing_rush: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMPUP || "10s", target: Number(__ENV.VUS || 100) }, // 오픈 직전 몰림 재현
        { duration: __ENV.DURATION || "20s", target: Number(__ENV.VUS || 100) },
        { duration: "5s", target: 0 },
      ],
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    // 전역 http_req_failed 는 안 쓴다 — queueStream/seatsStream 은 의도적으로 짧은
    // timeout 으로 끊기 때문에 k6 가 매번 "실패"로 집계한다(정상 동작). REST 뮤테이션
    // 엔드포인트만 태그로 좁혀서 실패율을 본다.
    "http_req_failed{endpoint:createSession}": ["rate<0.05"],
    "http_req_failed{endpoint:hold}": ["rate<0.05"],
    "http_req_failed{endpoint:confirm}": ["rate<0.05"],
    "http_req_duration{endpoint:createSession}": ["p(95)<800"],
    "http_req_duration{endpoint:hold}": ["p(95)<800"],
  },
};

function jsonHeaders(cookie) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  return headers;
}

export default function () {
  // 닉네임 2~10자 제약(guests/live 공통) 때문에 VU·ITER를 그대로 못 붙인다.
  const nickname = `lt${__VU % 100}i${__ITER % 100}`;

  // 1) 게스트 UUID 발급
  const guestRes = http.post(
    `${BASE_URL}/api/guests`,
    JSON.stringify({ nickname }),
    { headers: jsonHeaders(), tags: { endpoint: "guests" } },
  );
  if (!check(guestRes, { "guest 201": (r) => r.status === 201 })) {
    fail(`guest 발급 실패: ${guestRes.status} ${guestRes.body}`);
  }
  const guestUuid = guestRes.cookies.guest_uuid[0].value;
  const cookie = `guest_uuid=${guestUuid}`;

  // 2) 열린 회차 조회
  const currentRes = http.get(`${BASE_URL}/api/live/current`, {
    headers: jsonHeaders(cookie),
    tags: { endpoint: "current" },
  });
  const current = currentRes.json("data");
  if (!current || !current.roundId) {
    fail("열린 회차 없음 — admin/live/rounds/create-now 로 먼저 회차를 열어라");
  }
  const roundId = current.roundId;

  // 3) 세션 생성 (대기열 진입)
  const sessionRes = http.post(
    `${BASE_URL}/api/live/rounds/${roundId}/sessions`,
    JSON.stringify({ nickname }),
    { headers: jsonHeaders(cookie), tags: { endpoint: "createSession" } },
  );
  if (!check(sessionRes, { "session 201": (r) => r.status === 201 })) {
    seatErrorCount.add(1);
    return;
  }
  const sessionId = sessionRes.json("data.sessionId");

  // 4) 대기열 상태 확인 (active 될 때까지, 최대 15회 x 1s)
  // queue/stream 은 연결 직후 항상 최신 순번을 snapshot 으로 즉시 보내므로, 매번
  // 짧게 새로 붙었다 끊는 것만으로 기존 폴링과 동일한 정보를 얻을 수 있다.
  const queueStart = Date.now();
  let active = sessionRes.json("data.status") === "active";
  for (let i = 0; i < 15 && !active; i++) {
    sleep(1);
    const queueRes = http.get(
      `${BASE_URL}/api/live/rounds/${roundId}/queue/stream?sessionId=${sessionId}`,
      { headers: jsonHeaders(cookie), tags: { endpoint: "queueStream" }, timeout: "1.5s" },
    );
    const frame = firstSseFrame(queueRes.body);
    active = !!(frame && frame.data && frame.data.ready);
  }
  queueWaitTrend.add(Date.now() - queueStart);
  if (!active) {
    // 대기열 안 풀림 — 좌석 단계로 못 감. 정상 케이스로 집계하고 종료.
    return;
  }

  // BUY_RATE 미당첨(?)이면 여기서 종료 — 대기열/입장까지만 재현하고 좌석은 건드리지 않는다.
  // 실사용자가 좌석 선택 단계에서 봇과 경쟁하지 않도록 좌석 수요 자체를 줄이는 목적.
  if (Math.random() >= BUY_RATE) return;

  // 5) 좌석맵 조회 후 available 좌석 하나 선택
  // seats/stream 도 연결 직후 첫 프레임이 항상 전체 좌석 snapshot 이라 한 번만 붙었다
  // 끊으면 충분하다.
  const seatsRes = http.get(
    `${BASE_URL}/api/live/rounds/${roundId}/seats/stream?sessionId=${sessionId}`,
    { headers: jsonHeaders(cookie), tags: { endpoint: "seatsStream" }, timeout: "2s" },
  );
  const seatFrame = firstSseFrame(seatsRes.body);
  const seats = (seatFrame && seatFrame.data && seatFrame.data.seats) || [];
  const available = seats.filter((s) => s.status === "available");
  if (available.length === 0) return; // 매진 — 정상 종료

  const target = available[Math.floor(Math.random() * available.length)];

  // 6) hold 시도 (여러 VU가 같은 좌석 노릴 수 있음 → 409 경합이 정상)
  const holdRes = http.post(
    `${BASE_URL}/api/live/sessions/${sessionId}/hold`,
    JSON.stringify({ seatLabel: target.seatLabel }),
    { headers: jsonHeaders(cookie), tags: { endpoint: "hold" } },
  );
  if (holdRes.status !== 200) {
    if (holdRes.status === 409) seatConflictCount.add(1);
    else seatErrorCount.add(1);
    return;
  }

  // 7) confirm
  const confirmRes = http.post(
    `${BASE_URL}/api/live/sessions/${sessionId}/confirm`,
    JSON.stringify({ seatLabel: target.seatLabel }),
    { headers: jsonHeaders(cookie), tags: { endpoint: "confirm" } },
  );
  if (confirmRes.status === 200) {
    seatWinCount.add(1);
  } else if (confirmRes.status === 409) {
    seatConflictCount.add(1);
  } else {
    seatErrorCount.add(1);
  }
}
