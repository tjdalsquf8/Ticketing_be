import app from "./app";
import config from "./config";
import pool from "./config/db";
import { startCleanupCron } from "./jobs/cleanupSessions";
import { startLiveScheduler } from "./jobs/liveScheduler";

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

app.listen(PORT, () => {
  console.log(`서버 실행중: http://localhost:${PORT}`);
});
