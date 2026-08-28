import pool from '../config/db'
import { AppError } from '../middlewares/errorHandler'

const getMe = async (userId: number) => {
  const result = await pool.query(
    'SELECT id, email, name, role, points, created_at FROM users WHERE id = $1',
    [userId]
  )
  const user = result.rows[0]
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', '유저를 찾을 수 없습니다.')
  return user
}

export { getMe }
