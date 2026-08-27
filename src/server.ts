import app from "./app";
import config from "./config";
import pool from "./config/db";
import { startCleanupCron } from "./jobs/cleanupSessions";
import { startLiveScheduler } from "./jobs/liveScheduler";
import { startEventScheduler } from "./jobs/eventScheduler";
import { startHideEndedEventsCron } from "./jobs/hideEndedEvents";

const PORT = config.port;

// db 연결
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("DB 연결 실패:", err);
  } else {
    console.log("DB 연결 성공", res.rows[0].now);
  }
});

startCleanupCron();
startLiveScheduler();
// 이벤트 스케줄러는 부팅 시 DB 훑어서 미래 이벤트 재예약 + 놓친 발화 백필.
// await 하지 않아도 상관없지만 로그 순서를 위해 void 처리.
void startEventScheduler();
startHideEndedEventsCron();

app.listen(PORT, () => {
  console.log(`서버 실행중: http://localhost:${PORT}`);
});
