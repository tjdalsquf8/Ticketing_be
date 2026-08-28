import pool from "../config/db";
import {
  cleanupTestPracticeSessions,
  uniqueNickname,
  TEST_NICKNAME_PREFIX,
} from "./setup";

// 크론 정리 쿼리의 WHERE 조건과 동일한 술어(predicate) — 이걸 검증한다.
// runCleanup을 직접 호출하면 사용자 실제 데이터도 삭제될 수 있어 위험하므로
// 동일한 조건의 SELECT 쿼리로 "무엇이 삭제 대상인가"를 검증한다.
//
// 정책: 완료 세션은 completed_at 기준, 미완료 세션은 started_at 기준으로 30일.
const CLEANUP_PREDICATE = `
  (completed_at IS NOT NULL AND completed_at < NOW() - INTERVAL '30 days')
  OR
  (completed_at IS NULL     AND started_at   < NOW() - INTERVAL '30 days')
`;

const insertSession = async (params: {
  sessionId: string;
  guestUuid: string;
  nickname: string;
  startedAgo: string; // e.g., "31 days"
  completedAgo: string | null; // null이면 미완료
  elapsedMs?: number;
}) => {
  const { sessionId, guestUuid, nickname, startedAgo, completedAgo, elapsedMs } =
    params;
  if (completedAgo === null) {
    await pool.query(
      `INSERT INTO practice_sessions
         (session_id, user_id, guest_uuid, nickname, mode, event_id,
          ranking_eligible, started_at, completed_at, elapsed_ms)
       VALUES ($1, NULL, $2, $3, 'practice', NULL, true,
               NOW() - INTERVAL '${startedAgo}', NULL, NULL)`,
      [sessionId, guestUuid, nickname],
    );
  } else {
    await pool.query(
      `INSERT INTO practice_sessions
         (session_id, user_id, guest_uuid, nickname, mode, event_id,
          ranking_eligible, started_at, completed_at, elapsed_ms)
       VALUES ($1, NULL, $2, $3, 'practice', NULL, true,
               NOW() - INTERVAL '${startedAgo}', NOW() - INTERVAL '${completedAgo}', $4)`,
      [sessionId, guestUuid, nickname, elapsedMs ?? 5000],
    );
  }
};

describe("Cleanup Cron Logic", () => {
  beforeAll(cleanupTestPracticeSessions);
  afterAll(cleanupTestPracticeSessions);

  describe("[9] 30일 지난 세션 삭제 대상 판정", () => {
    it("완료·미완료 모두 30일 지난 것만 삭제 대상", async () => {
      const oldNick            = uniqueNickname();
      const recentNick         = uniqueNickname();
      const oldUncompletedNick = uniqueNickname();
      const newUncompletedNick = uniqueNickname();

      // 20-char session_id 사용
      const oldSid            = `prc_${"a".repeat(16)}`;
      const recentSid         = `prc_${"b".repeat(16)}`;
      const oldUncompletedSid = `prc_${"c".repeat(16)}`;
      const newUncompletedSid = `prc_${"d".repeat(16)}`;

      await insertSession({
        sessionId: oldSid,
        guestUuid: "11111111-1111-1111-1111-111111111111",
        nickname: oldNick,
        startedAgo: "31 days",
        completedAgo: "31 days",
      });

      await insertSession({
        sessionId: recentSid,
        guestUuid: "22222222-2222-2222-2222-222222222222",
        nickname: recentNick,
        startedAgo: "29 days",
        completedAgo: "29 days",
      });

      // 40일 지난 미완료 → 새 정책상 삭제 대상 O
      await insertSession({
        sessionId: oldUncompletedSid,
        guestUuid: "33333333-3333-3333-3333-333333333333",
        nickname: oldUncompletedNick,
        startedAgo: "40 days",
        completedAgo: null,
      });

      // 10일 지난 미완료 → 대상 X (아직 30일 안 지남)
      await insertSession({
        sessionId: newUncompletedSid,
        guestUuid: "44444444-4444-4444-4444-444444444444",
        nickname: newUncompletedNick,
        startedAgo: "10 days",
        completedAgo: null,
      });

      // 크론 쿼리와 동일한 WHERE 조건으로 "삭제 대상 세션" 조회 (테스트 데이터만 스코프)
      const wouldDelete = await pool.query(
        `SELECT nickname FROM practice_sessions
         WHERE (${CLEANUP_PREDICATE})
           AND nickname LIKE $1`,
        [`${TEST_NICKNAME_PREFIX}%`],
      );

      const targets = wouldDelete.rows.map(
        (r: { nickname: string }) => r.nickname,
      );

      // 31일 지난 완료 세션 → 삭제 대상 O
      expect(targets).toContain(oldNick);
      // 40일 지난 미완료 세션 → 삭제 대상 O (신규 정책)
      expect(targets).toContain(oldUncompletedNick);
      // 29일 지난 완료 세션 → 삭제 대상 X
      expect(targets).not.toContain(recentNick);
      // 10일 지난 미완료 세션 → 삭제 대상 X
      expect(targets).not.toContain(newUncompletedNick);
    });
  });
});
