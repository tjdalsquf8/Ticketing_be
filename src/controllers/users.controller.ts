import { Request, Response } from "express";
import * as usersService from "../services/users.service";

const getMe = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const user = await usersService.getMe(userId);
  res.status(200).json({ success: true, data: user });
};

export { getMe };
