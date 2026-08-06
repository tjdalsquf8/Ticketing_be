import { Router } from "express";
import * as guestsController from "../controllers/guests.controller";

const router = Router();

router.get("/me", guestsController.getMe);
router.delete("/me", guestsController.deleteMe);

export default router;
