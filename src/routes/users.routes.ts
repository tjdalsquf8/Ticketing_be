import { Router } from 'express'
import { getMe } from '../controllers/users.controller'
import authMiddleware from '../middlewares/authMiddleware'

const router = Router()

router.get('/me', authMiddleware, getMe)

export default router
