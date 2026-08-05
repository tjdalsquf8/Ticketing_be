import app from "./app";
import config from "./config";
import pool from "./config/db";

const PORT = config.port;

// db 연결
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("DB 연결 실패:", err);
  } else {
    console.log("DB 연결 성공", res.rows[0].now);
  }
});

app.listen(PORT, () => {
  console.log(`서버 실행중: http://localhost:${PORT}`);
});
