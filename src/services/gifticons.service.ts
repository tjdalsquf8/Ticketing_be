import pool from "../config/db";
import { AppError } from "../middlewares/errorHandler";

type GifticonStatus = "available" | "issued" | "redeemed" | "expired";

type GifticonListRow = {
  id: number;
  category: string;
  productName: string;
  faceValue: number;
  codeMasked: string;
  status: GifticonStatus;
  createdAt: string;
};

type GifticonDetail = Omit<GifticonListRow, "codeMasked"> & { code: string };

type GifticonSummary = {
  total: number;
  available: number;
  issued: number;
  redeemed: number;
  expired: number;
};

const maskCode = (code: string): string => `****${code.slice(-4)}`;

const mapListRow = (row: {
  id: number;
  category: string;
  product_name: string;
  face_value: number;
  code: string;
  status: GifticonStatus;
  created_at: string;
}): GifticonListRow => ({
  id: row.id,
  category: row.category,
  productName: row.product_name,
  faceValue: row.face_value,
  codeMasked: maskCode(row.code),
  status: row.status,
  createdAt: row.created_at,
});

const isUniqueViolation = (err: unknown): boolean =>
  err != null &&
  typeof err === "object" &&
  "code" in err &&
  (err as { code: unknown }).code === "23505";

// ─── 목록 조회 ───────────────────────────────────────────────────────────────

const listGifticons = async (params: {
  category?: string;
  status?: string;
  q?: string;
  page: number;
  limit: number;
}): Promise<{ data: GifticonListRow[]; totalCount: number }> => {
  const { category, status, q, page, limit } = params;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (category) {
    conditions.push(`category = $${idx++}`);
    values.push(category);
  }
  if (status) {
    conditions.push(`status = $${idx++}`);
    values.push(status);
  }
  if (q) {
    // code는 원본이 목록 응답에 절대 노출되지 않는 필드라, 검색 대상에도 포함하지
    // 않는다 — 포함 시 결과 유무만으로 원본 코드를 한 글자씩 추측당할 수 있음(오라클).
    conditions.push(`product_name ILIKE $${idx}`);
    values.push(`%${q}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM public.gifticons ${where}`,
    values,
  );
  const totalCount = parseInt(countResult.rows[0].count, 10);

  const dataResult = await pool.query(
    `SELECT id, category, product_name, face_value, code, status, created_at
     FROM public.gifticons
     ${where}
     ORDER BY created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, limit, offset],
  );

  return { data: dataResult.rows.map(mapListRow), totalCount };
};

// ─── 요약 집계 ───────────────────────────────────────────────────────────────

const getSummary = async (): Promise<GifticonSummary> => {
  const result = await pool.query(
    `SELECT status, COUNT(*)::int AS count FROM public.gifticons GROUP BY status`,
  );
  const summary: GifticonSummary = {
    total: 0,
    available: 0,
    issued: 0,
    redeemed: 0,
    expired: 0,
  };
  for (const row of result.rows) {
    if (row.status in summary) {
      (summary as Record<string, number>)[row.status] = row.count;
    }
    summary.total += row.count;
  }
  return summary;
};

// ─── 상세 조회 (원본 코드 노출 + 감사로그) ───────────────────────────────────

const getGifticonDetail = async (
  id: number,
  viewedBy: number,
): Promise<GifticonDetail> => {
  const result = await pool.query(
    `SELECT id, category, product_name, face_value, code, status, created_at
     FROM public.gifticons WHERE id = $1`,
    [id],
  );
  if (result.rows.length === 0) {
    throw new AppError(404, "GIFTICON_NOT_FOUND", "재고를 찾을 수 없습니다.");
  }
  const row = result.rows[0];

  await pool.query(
    `INSERT INTO public.gifticon_view_logs (gifticon_id, viewed_by) VALUES ($1, $2)`,
    [id, viewedBy],
  );

  return {
    id: row.id,
    category: row.category,
    productName: row.product_name,
    faceValue: row.face_value,
    code: row.code,
    status: row.status,
    createdAt: row.created_at,
  };
};

// ─── 등록 ────────────────────────────────────────────────────────────────────

const createGifticon = async (
  params: { category: string; productName: string; faceValue: number; code: string },
  createdBy: number,
): Promise<GifticonDetail> => {
  const { category, productName, faceValue, code } = params;
  try {
    const result = await pool.query(
      `INSERT INTO public.gifticons (category, product_name, face_value, code, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, category, product_name, face_value, code, status, created_at`,
      [category, productName, faceValue, code, createdBy],
    );
    const row = result.rows[0];
    return {
      id: row.id,
      category: row.category,
      productName: row.product_name,
      faceValue: row.face_value,
      code: row.code,
      status: row.status,
      createdAt: row.created_at,
    };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, "GIFTICON_CODE_DUPLICATE", "이미 등록된 바코드 번호입니다.");
    }
    throw err;
  }
};

// ─── 수정 (available 상태만 가능) ────────────────────────────────────────────

const updateGifticon = async (
  id: number,
  params: { productName?: string; faceValue?: number; code?: string },
): Promise<GifticonListRow> => {
  const { productName, faceValue, code } = params;

  const existing = await pool.query(
    `SELECT status FROM public.gifticons WHERE id = $1`,
    [id],
  );
  if (existing.rows.length === 0) {
    throw new AppError(404, "GIFTICON_NOT_FOUND", "재고를 찾을 수 없습니다.");
  }
  if (existing.rows[0].status !== "available") {
    throw new AppError(
      409,
      "GIFTICON_NOT_EDITABLE",
      "available 상태인 재고만 수정할 수 있습니다.",
    );
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (productName !== undefined) {
    sets.push(`product_name = $${idx++}`);
    values.push(productName);
  }
  if (faceValue !== undefined) {
    sets.push(`face_value = $${idx++}`);
    values.push(faceValue);
  }
  if (code !== undefined) {
    sets.push(`code = $${idx++}`);
    values.push(code);
  }
  sets.push(`updated_at = NOW()`);

  values.push(id);

  try {
    const result = await pool.query(
      `UPDATE public.gifticons SET ${sets.join(", ")}
       WHERE id = $${idx} AND status = 'available'
       RETURNING id, category, product_name, face_value, code, status, created_at`,
      values,
    );
    if (result.rows.length === 0) {
      throw new AppError(
        409,
        "GIFTICON_NOT_EDITABLE",
        "available 상태인 재고만 수정할 수 있습니다.",
      );
    }
    // 원본 code는 감사로그가 남는 상세 조회(GET /:id)에서만 노출한다.
    // 수정 응답에 원본을 그대로 돌려주면 PATCH로 감사 없이 코드를 열람하는 우회로가 생긴다.
    return mapListRow(result.rows[0]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, "GIFTICON_CODE_DUPLICATE", "이미 등록된 바코드 번호입니다.");
    }
    throw err;
  }
};

// ─── 삭제 (available 상태만 가능) ────────────────────────────────────────────

const deleteGifticon = async (id: number): Promise<void> => {
  const result = await pool.query(
    `DELETE FROM public.gifticons WHERE id = $1 AND status = 'available'`,
    [id],
  );
  if (result.rowCount === 0) {
    const existing = await pool.query(
      `SELECT status FROM public.gifticons WHERE id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      throw new AppError(404, "GIFTICON_NOT_FOUND", "재고를 찾을 수 없습니다.");
    }
    throw new AppError(
      409,
      "GIFTICON_NOT_DELETABLE",
      "available 상태인 재고만 삭제할 수 있습니다.",
    );
  }
};

export {
  listGifticons,
  getSummary,
  getGifticonDetail,
  createGifticon,
  updateGifticon,
  deleteGifticon,
};
