import { randomBytes } from "crypto";
import pool from "../config/db";
import { AppError } from "../middlewares/errorHandler";

const generateSessionId = () => `prc_${randomBytes(8).toString("hex")}`;

// 게스트 UUID의 최초 닉네임 조회 (immutability 기준 값)
const getEarliestNicknameByUuid = async (
  guestUuid: string,
): Promise<string | null> => {
  const result = await pool.query(
    `SELECT nickname FROM practice_sessions
     WHERE guest_uuid = $1
     ORDER BY started_at ASC
     LIMIT 1`,
    [guestUuid],
  );
  return result.rows[0]?.nickname ?? null;
};

// 비로그인 유저의 nickname 소유권을 확인 (최초 UUID만 정식 소유자)
const isNicknameOwnedByOther = async (
  nickname: string,
  requesterUuid: string,
): Promise<boolean> => {
  const result = await pool.query(
    `SELECT guest_uuid FROM practice_sessions
     WHERE nickname = $1 AND guest_uuid IS NOT NULL AND user_id IS NULL
     ORDER BY started_at ASC
     LIMIT 1`,
    [nickname],
  );
  const ownerUuid = result.rows[0]?.guest_uuid;
  return !!ownerUuid && ownerUuid !== requesterUuid;
};

const startSession = async (params: {
  userId?: number;
  guestUuid?: string;
  nickname: string;
  mode: string;
  eventId?: number;
}) => {
  const { userId, guestUuid, nickname, mode, eventId } = params;
  const sessionId = generateSessionId();

  // 닉네임 immutability: 게스트가 기존에 세션 있으면 최초 닉네임으로 강제
  let effectiveNickname = nickname;
  if (!userId && guestUuid) {
    const priorNickname = await getEarliestNicknameByUuid(guestUuid);
    if (priorNickname) {
      effectiveNickname = priorNickname;
    } else if (!nickname) {
      // 쿠키 UUID는 있지만 이력 없음(30일 크론 삭제 등) + 신규 닉 미제공
      throw new AppError(
        400,
        "NICKNAME_REQUIRED",
        "닉네임이 필요합니다.",
      );
    }
  }

  // 소유권 판정: 로그인 유저는 항상 true, 비로그인은 최초 UUID만 true
  let rankingEligible = true;
  if (!userId && guestUuid) {
    const isImpostor = await isNicknameOwnedByOther(effectiveNickname, guestUuid);
    if (isImpostor) rankingEligible = false;
  }

  const result = await pool.query(
    `INSERT INTO practice_sessions
       (session_id, user_id, guest_uuid, nickname, mode, event_id, ranking_eligible)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING session_id, started_at`,
    [
      sessionId,
      userId ?? null,
      guestUuid ?? null,
      effectiveNickname,
      mode,
      eventId ?? null,
      rankingEligible,
    ],
  );

  return { ...result.rows[0], nickname: effectiveNickname };
};

const completeSession = async (params: {
  sessionId: string;
  userId?: number;
  guestUuid?: string;
}) => {
  const { sessionId, userId, guestUuid } = params;

  const session = await pool.query(
    `SELECT session_id, user_id, guest_uuid, nickname, mode, event_id,
            started_at, completed_at, ranking_eligible
     FROM practice_sessions WHERE session_id = $1`,
    [sessionId],
  );

  if (session.rows.length === 0) {
    throw new AppError(404, "SESSION_NOT_FOUND", "세션을 찾을 수 없습니다.");
  }

  const s = session.rows[0];

  if (s.completed_at) {
    throw new AppError(
      409,
      "SESSION_ALREADY_COMPLETED",
      "이미 완료된 세션입니다.",
    );
  }

  if (userId && s.user_id !== userId) {
    throw new AppError(403, "SESSION_FORBIDDEN", "세션에 접근할 권한이 없습니다.");
  }
  if (!userId && guestUuid && s.guest_uuid !== guestUuid) {
    throw new AppError(403, "SESSION_FORBIDDEN", "세션에 접근할 권한이 없습니다.");
  }

  const completed = await pool.query(
    `UPDATE practice_sessions
     SET completed_at = NOW(),
         elapsed_ms = ROUND(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::int
     WHERE session_id = $1
     RETURNING elapsed_ms`,
    [sessionId],
  );

  const elapsedMs = completed.rows[0].elapsed_ms;
  const ranked: boolean = s.ranking_eligible;

  if (!ranked) {
    return {
      elapsedMs,
      ranked: false,
      rankPercentile: null,
      sessionRank: null,
      totalSessions: null,
    };
  }

  const eventId: number | null = s.event_id ?? null;
  const rankParams: (number | string | null)[] = [elapsedMs, s.mode];
  const eventFilter =
    eventId !== null
      ? (() => {
          rankParams.push(eventId);
          return `AND event_id = $${rankParams.length}`;
        })()
      : "AND event_id IS NULL";

  // 완료 팝업의 등수는 **시도(세션) 누적** 기준이다. 같은 사람이 여러 번 참여하면
  // 그 시도들이 각각 별개로 카운트된다.
  //
  // 예전에는 여기서 `GROUP BY COALESCE(user_id::text, guest_uuid)` 로 참가자별
  // 개인 최고기록 한 줄씩만 남겼다. 그래서 같은 게스트가 몇 번을 반복해도
  // totalCount 가 참가자 수에 고정돼 "안 늘어나는" 것처럼 보였다.
  //
  // 리더보드(GET /rankings)는 여전히 참가자별 개인 최고기록으로 dedup 한다.
  // 목적이 다른 지표이므로 두 곳의 기준이 다른 것이 의도된 동작이다.
  const rank = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE elapsed_ms > $1) AS slower,
       COUNT(*) AS total
     FROM practice_sessions
     WHERE completed_at IS NOT NULL
       AND mode = $2
       AND ranking_eligible = true
       ${eventFilter}`,
    rankParams,
  );

  const { slower, total } = rank.rows[0];
  const totalSessions = Number(total);
  // 나보다 느린 시도를 전체에서 뺀 값 = 나와 같거나 빠른 시도 수 = 내 등수.
  // 이 세션은 위에서 이미 completed 로 갱신됐으므로 집계에 포함된다.
  const sessionRank = totalSessions - Number(slower);
  // 상위 몇 %인지. 프론트가 "상위 N%" 로 그대로 표시하므로 등수 비율이어야 한다.
  // 예전에는 slower/total, 즉 "내가 이긴 시도의 비율" 을 돌려줘서 1등이 상위 99% 로
  // 표시되는 정반대 값이 나갔다. 값이 작을수록 좋은 기록이다.
  const rankPercentile =
    totalSessions > 0 ? Math.round((sessionRank / totalSessions) * 1000) / 10 : 0;

  return { elapsedMs, ranked: true, rankPercentile, sessionRank, totalSessions };
};

export { startSession, completeSession };
