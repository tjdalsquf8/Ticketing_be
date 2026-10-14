// k6 --summary-export JSON에서 핵심 지표만 뽑아 results.csv에 한 줄 append.
//
// 사용: node load-test/log-result.js <label> <summaryJsonPath> <poolMax> <batchCap>
const fs = require("fs");
const path = require("path");

const [, , label, summaryPath, poolMax, batchCap] = process.argv;
if (!label || !summaryPath) {
  console.error(
    "Usage: node load-test/log-result.js <label> <summaryJsonPath> <poolMax> <batchCap>",
  );
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const metrics = summary.metrics || {};

const p95 = (key) => metrics[key]?.values?.["p(95)"];
const count = (key) => metrics[key]?.values?.count;

const row = {
  timestamp: new Date().toISOString(),
  label,
  poolMax: poolMax ?? "",
  batchCap: batchCap ?? "",
  createSession_p95_ms: p95("http_req_duration{endpoint:createSession}"),
  hold_p95_ms: p95("http_req_duration{endpoint:hold}"),
  queueWait_p95_ms: p95("queue_wait_ms"),
  seatConfirmSuccess: count("seat_confirm_success"),
  seatConfirmConflict: count("seat_confirm_conflict"),
  seatConfirmError: count("seat_confirm_error"),
};

const csvPath = path.join(__dirname, "results.csv");
const header = Object.keys(row).join(",") + "\n";
const line = Object.values(row).join(",") + "\n";

if (!fs.existsSync(csvPath)) {
  fs.writeFileSync(csvPath, header);
}
fs.appendFileSync(csvPath, line);

console.log(`[log-result] ${label} 기록 완료 -> ${csvPath}`);
console.log(row);
