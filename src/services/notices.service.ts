import pool from "../config/db";
import { AppError } from "../middlewares/errorHandler";

type NoticeKind = "notice" | "update" | "fix";

type NoticeListRow = {
  id: number;
  kind: NoticeKind;
  title: string;
  createdAt: string;
};

type NoticeDetail = NoticeListRow & { content: string | null };

const mapListRow = (row: {
  id: number;
  kind: NoticeKind;
  title: string;
  created_at: string;
}): NoticeListRow => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  createdAt: row.created_at,
});

const mapDetailRow = (row: {
  id: number;
  kind: NoticeKind;
  title: string;
  content: string | null;
  created_at: string;
}): NoticeDetail => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  content: row.content,
  createdAt: row.created_at,
});

// ─── 공개 목록 ───────────────────────────────────────────────────────────────

// 공지는 관리자가 가끔 쓰는 데이터인데 홈이 열릴 때마다 조회된다. 새로고침 폭주 시
// 같은 SELECT 가 그대로 DB 로 반복되므로 프로세스 메모리에 캐시한다.
// 키는 limit(컨트롤러에서 1~100 으로 상한) 이라 무한히 늘지 않는다.
// 서버 1대 단일 프로세스 구성이라 Redis 없이 Map 으로 충분하다.
const LIST_CACHE_TTL_MS = 60 * 1000;
const listCache = new Map<number, { data: NoticeListRow[]; expiresAt: number }>();

/** 공지 생성·수정·삭제 시 호출. 캐시가 살아있으면 관리자 변경이 최대 60초 늦게 보인다. */
const invalidateListCache = () => {
  listCache.clear();
};

const listNotices = async (limit: number): Promise<NoticeListRow[]> => {
  const cached = listCache.get(limit);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const result = await pool.query(
    `SELECT id, kind, title, created_at
     FROM public.notices
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
  const data = result.rows.map(mapListRow);

  listCache.set(limit, { data, expiresAt: Date.now() + LIST_CACHE_TTL_MS });
  return data;
};

// ─── 공개 상세 ───────────────────────────────────────────────────────────────

const getNoticeById = async (id: number): Promise<NoticeDetail> => {
  const result = await pool.query(
    `SELECT id, kind, title, content, created_at
     FROM public.notices WHERE id = $1`,
    [id],
  );
  if (result.rows.length === 0) {
    throw new AppError(404, "NOTICE_NOT_FOUND", "공지사항을 찾을 수 없습니다.");
  }
  return mapDetailRow(result.rows[0]);
};

// ─── 어드민 목록 ─────────────────────────────────────────────────────────────

const adminListNotices = async (params: {
  page: number;
  limit: number;
}): Promise<{ data: NoticeDetail[]; totalCount: number }> => {
  const { page, limit } = params;
  const offset = (page - 1) * limit;

  const countResult = await pool.query(`SELECT COUNT(*) FROM public.notices`);
  const totalCount = parseInt(countResult.rows[0].count, 10);

  const dataResult = await pool.query(
    `SELECT id, kind, title, content, created_at
     FROM public.notices
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  return { data: dataResult.rows.map(mapDetailRow), totalCount };
};

// ─── 등록 ────────────────────────────────────────────────────────────────────

const createNotice = async (
  params: { kind: NoticeKind; title: string; content?: string },
  createdBy: number,
): Promise<NoticeDetail> => {
  const { kind, title, content } = params;
  const result = await pool.query(
    `INSERT INTO public.notices (kind, title, content, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, kind, title, content, created_at`,
    [kind, title, content ?? null, createdBy],
  );
  invalidateListCache();
  return mapDetailRow(result.rows[0]);
};

// ─── 수정 ────────────────────────────────────────────────────────────────────

const updateNotice = async (
  id: number,
  params: { kind?: NoticeKind; title?: string; content?: string },
): Promise<NoticeDetail> => {
  const { kind, title, content } = params;

  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (kind !== undefined) {
    sets.push(`kind = $${idx++}`);
    values.push(kind);
  }
  if (title !== undefined) {
    sets.push(`title = $${idx++}`);
    values.push(title);
  }
  if (content !== undefined) {
    sets.push(`content = $${idx++}`);
    values.push(content);
  }
  sets.push(`updated_at = NOW()`);

  values.push(id);

  const result = await pool.query(
    `UPDATE public.notices SET ${sets.join(", ")}
     WHERE id = $${idx}
     RETURNING id, kind, title, content, created_at`,
    values,
  );
  if (result.rows.length === 0) {
    throw new AppError(404, "NOTICE_NOT_FOUND", "공지사항을 찾을 수 없습니다.");
  }
  invalidateListCache();
  return mapDetailRow(result.rows[0]);
};

// ─── 삭제 ────────────────────────────────────────────────────────────────────

const deleteNotice = async (id: number): Promise<void> => {
  const result = await pool.query(`DELETE FROM public.notices WHERE id = $1`, [id]);
  if (result.rowCount === 0) {
    throw new AppError(404, "NOTICE_NOT_FOUND", "공지사항을 찾을 수 없습니다.");
  }
  invalidateListCache();
};

export {
  listNotices,
  getNoticeById,
  adminListNotices,
  createNotice,
  updateNotice,
  deleteNotice,
};
