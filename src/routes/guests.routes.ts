import { Router } from "express";
import * as guestsController from "../controllers/guests.controller";
import { postGuestValidator } from "../middlewares/validators/guests.validator";

const router = Router();

router.post("/", postGuestValidator, guestsController.postGuest);
router.get("/me", guestsController.getMe);
router.delete("/me", guestsController.deleteMe);

export default router;
