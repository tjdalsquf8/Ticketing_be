import cron from "node-cron";
import pool from "../config/db";

const CLEANUP_SCHEDULE = "0 4 * * *";
const TIMEZONE = "Asia/Seoul";

const runCleanup = async () => {
  try {
    const result = await pool.query(
      `DELETE FROM practice_sessions
       WHERE completed_at IS NOT NULL
         AND completed_at < NOW() - INTERVAL '30 days'`,
    );
    console.log(
      `[cleanup] ${new Date().toISOString()} - deleted ${result.rowCount} sessions`,
    );
  } catch (err) {
    console.error("[cleanup] failed:", err);
  }
};

export const startCleanupCron = () => {
  cron.schedule(CLEANUP_SCHEDULE, runCleanup, { timezone: TIMEZONE });
  console.log(`[cleanup] cron registered (${CLEANUP_SCHEDULE} ${TIMEZONE})`);
};
