import cron from "node-cron";
import {
  ROUND_DURATION_MINUTES,
  ensureUpcomingRounds,
  transitionRounds,
} from "../services/live.service";

const TIMEZONE = "Asia/Seoul";
const ENSURE_SCHEDULE = "0 0 * * *"; // 매일 KST 00시 (그날 24시간 회차 pre-create)
// 회차 이벤트는 매 시각 :00 (open) 과 :ROUND_DURATION_MINUTES (close) 두 번만 발생.
// 크론을 이 두 분에만 트리거해 하루 폴링을 1,440 → 48회로 압축하면서도 지연 0을 유지한다.
// ROUND_DURATION_MINUTES 가 0 이거나 60 이상이 되면 크론 표현식이 깨지므로 방어.
if (
  !Number.isInteger(ROUND_DURATION_MINUTES) ||
  ROUND_DURATION_MINUTES <= 0 ||
  ROUND_DURATION_MINUTES >= 60
) {
  throw new Error(
    `[liveScheduler] ROUND_DURATION_MINUTES must be integer in (0,60), got ${ROUND_DURATION_MINUTES}`,
  );
}
const TRANSITION_SCHEDULE = `0,${ROUND_DURATION_MINUTES} * * * *`;

const runEnsure = async (fromMidnight: boolean = false) => {
  try {
    await ensureUpcomingRounds(fromMidnight);
  } catch (err) {
    console.error("[live/ensure] failed:", err);
  }
};

const runTransition = async () => {
  try {
    await transitionRounds();
  } catch (err) {
    console.error("[live/transition] failed:", err);
  }
};

export const startLiveScheduler = () => {
  cron.schedule(ENSURE_SCHEDULE, () => runEnsure(true), { timezone: TIMEZONE });
  cron.schedule(TRANSITION_SCHEDULE, runTransition, { timezone: TIMEZONE });
  console.log(
    `[live] scheduler registered (ensure=${ENSURE_SCHEDULE}, transition=${TRANSITION_SCHEDULE}, tz=${TIMEZONE})`,
  );

  // 서버 시작 즉시 1회 실행: 오늘 남은 정각(다음 정각~KST 23시)만 채움
  void runEnsure(false);
  void runTransition();
};
