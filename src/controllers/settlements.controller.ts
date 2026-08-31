import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import * as settlementsService from "../services/settlements.service";
import { AppError } from "../middlewares/errorHandler";

const handleValidation = (req: Request, next: NextFunction): boolean => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    next(new AppError(400, "VALIDATION_ERROR", errors.array()[0].msg));
    return true;
  }
  return false;
};

// GET /api/admin/settlements/gifticons
const listSettlements = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const page = parseInt(req.query.page as string) || 1;
    const size = Math.min(parseInt(req.query.size as string) || 20, 200);

    const { data, totalCount } = await settlementsService.listSettlements({
      status: req.query.status as "pending" | "issued" | undefined,
      eventId: req.query.eventId ? parseInt(req.query.eventId as string, 10) : undefined,
      page,
      size,
    });

    res.status(200).json({ success: true, data, meta: { page, size, totalCount } });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/settlements/gifticons/:id/issue
const issueSettlement = async (req: Request, res: Response, next: NextFunction) => {
  if (handleValidation(req, next)) return;

  try {
    const id = req.params.id as string;
    const { gifticonId } = req.body;
    const data = await settlementsService.issueSettlement(id, gifticonId);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

export { listSettlements, issueSettlement };
