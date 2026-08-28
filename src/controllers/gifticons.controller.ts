import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import * as gifticonsService from "../services/gifticons.service";
import { AppError } from "../middlewares/errorHandler";

const handleValidation = (req: Request, next: NextFunction): boolean => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    next(new AppError(400, "VALIDATION_ERROR", errors.array()[0].msg));
    return true;
  }
  return false;
};

// GET /api/admin/gifticons
const listGifticons = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const { data, totalCount } = await gifticonsService.listGifticons({
      category: req.query.category as string | undefined,
      status: req.query.status as string | undefined,
      q: req.query.q as string | undefined,
      page,
      limit,
    });

    res.status(200).json({ success: true, data, meta: { totalCount, page, limit } });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/gifticons/summary
const getSummary = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await gifticonsService.getSummary();
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/gifticons/:id
const getGifticonDetail = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const id = parseInt(req.params.id as string, 10);
    const viewedBy = req.user!.id;
    const data = await gifticonsService.getGifticonDetail(id, viewedBy);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/gifticons
const createGifticon = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const createdBy = req.user!.id;
    // Mass Assignment 방지: 허용 필드만 추출 (status는 서비스에서 항상 'available'로 시작).
    const { category, productName, faceValue, code } = req.body;
    const data = await gifticonsService.createGifticon(
      { category, productName, faceValue, code },
      createdBy,
    );
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/admin/gifticons/:id
const updateGifticon = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const id = parseInt(req.params.id as string, 10);
    const { productName, faceValue, code } = req.body;
    const data = await gifticonsService.updateGifticon(id, { productName, faceValue, code });
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/admin/gifticons/:id
const deleteGifticon = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const id = parseInt(req.params.id as string, 10);
    await gifticonsService.deleteGifticon(id);
    res.status(200).json({ success: true, data: null });
  } catch (err) {
    next(err);
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
