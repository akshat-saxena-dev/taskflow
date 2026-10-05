import { Router } from 'express';
import { register, login, logout, me } from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { loginRateLimiter } from '../middleware/rateLimit';

export const authRouter = Router();

authRouter.post('/register', register);
authRouter.post('/login', loginRateLimiter, login);
authRouter.post('/logout', logout);
authRouter.get('/me', authenticate, me);
