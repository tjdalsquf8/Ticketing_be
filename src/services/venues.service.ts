import pool from "../config/db";

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface VenueDetailRow {
  venueId: string; // slug 문자열
  name: string;
  layout: string;
  totalSeats: number;
  thumbnailUrl: string | null;
  config: unknown; // FE VenueConfig 타입 그대로 (tiers/zones/mapGrid 등)
}

interface ServiceError extends Error {
  code: string;
  status: number;
}

function makeError(code: string, status: number, message: string): ServiceError {
  const err = new Error(message) as ServiceError;
  err.code = code;
  err.status = status;
  return err;
}

// ─── 공개 API 서비스 ─────────────────────────────────────────────────────────

/**
 * slug 로 공연장 상세(geometry 포함) 조회.
 * 실시간 티켓팅(좌석맵)과 이벤트 티켓팅(참여 좌석 선택)이 공용으로 사용한다.
 */
async function getVenueBySlug(slug: string): Promise<VenueDetailRow> {
  const res = await pool.query(
    `SELECT slug AS "venueId", name, layout, total_seats AS "totalSeats",
            thumbnail_url AS "thumbnailUrl", config
     FROM public.venues
     WHERE slug = $1`,
    [slug],
  );
  if (res.rows.length === 0) {
    throw makeError("VENUE_NOT_FOUND", 404, "공연장을 찾을 수 없습니다.");
  }
  return res.rows[0];
}

export { getVenueBySlug };
