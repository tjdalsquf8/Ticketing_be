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
      rankNumber: null,
      totalCount: null,
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

  const rank = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE best_ms > $1) AS slower,
       COUNT(*) AS total
     FROM (
       SELECT MIN(elapsed_ms) AS best_ms
       FROM practice_sessions
       WHERE completed_at IS NOT NULL
         AND mode = $2
         AND ranking_eligible = true
         ${eventFilter}
       GROUP BY COALESCE(user_id::text, guest_uuid)
     ) best_records`,
    rankParams,
  );

  const { slower, total } = rank.rows[0];
  const totalCount = Number(total);
  const rankNumber = totalCount - Number(slower);
  const rankPercentile =
    totalCount > 0 ? Math.round((Number(slower) / totalCount) * 1000) / 10 : 0;

  return { elapsedMs, ranked: true, rankPercentile, rankNumber, totalCount };
};

export { startSession, completeSession };
