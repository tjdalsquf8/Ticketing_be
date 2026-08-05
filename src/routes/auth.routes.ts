import { Router } from "express";
import {
  register,
  login,
  logout,
  refresh,
} from "../controllers/auth.controller";
import authMiddleware from "../middlewares/authMiddleware";
import {
  registerValidator,
  loginValidator,
} from "../middlewares/validators/auth.validator";
import {
  loginLimiter,
  registerLimiter,
  refreshLimiter,
} from "../middlewares/rateLimiter";

const router = Router();

router.post("/register", registerLimiter, registerValidator, register);
router.post("/login", loginLimiter, loginValidator, login);
router.post("/refresh", refreshLimiter, refresh);
router.post("/logout", authMiddleware, logout);

export default router;
