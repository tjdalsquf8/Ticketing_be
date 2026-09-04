import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import * as noticesService from "../services/notices.service";
import { AppError } from "../middlewares/errorHandler";

const handleValidation = (req: Request, next: NextFunction): boolean => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    next(new AppError(400, "VALIDATION_ERROR", errors.array()[0].msg));
    return true;
  }
  return false;
};

// GET /api/notices
const listNotices = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const data = await noticesService.listNotices(limit);
    // 브라우저 캐시. 서버 캐시(60초)와 달리 이건 요청 자체를 서버까지 안 보낸다
    // → 새로고침 연타로 rate limit 예산이 깎이는 것을 막는 유일한 층.
    // 관리자 변경이 최대 60초 늦게 보이는 것을 감수한다.
    res.setHeader("Cache-Control", "public, max-age=60");
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// GET /api/notices/:id
const getNoticeById = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const id = parseInt(req.params.id as string, 10);
    const data = await noticesService.getNoticeById(id);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/notices
const adminListNotices = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const { data, totalCount } = await noticesService.adminListNotices({ page, limit });
    res.status(200).json({ success: true, data, meta: { totalCount, page, limit } });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/notices
const createNotice = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const createdBy = req.user!.id;
    const { kind, title, content } = req.body;
    const data = await noticesService.createNotice({ kind, title, content }, createdBy);
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/admin/notices/:id
const updateNotice = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const id = parseInt(req.params.id as string, 10);
    const { kind, title, content } = req.body;
    const data = await noticesService.updateNotice(id, { kind, title, content });
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/admin/notices/:id
const deleteNotice = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const id = parseInt(req.params.id as string, 10);
    await noticesService.deleteNotice(id);
    res.status(200).json({ success: true, data: null });
  } catch (err) {
    next(err);
  }
};

export {
  listNotices,
  getNoticeById,
  adminListNotices,
  createNotice,
  updateNotice,
  deleteNotice,
};
