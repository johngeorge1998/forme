import { Router } from 'express';
import { register, login, refresh, logout } from '../controllers/authController';

const router = Router();

// Register User
router.post('/register', register);

// Login User
router.post('/login', login);

// Refresh Token
router.post('/refresh', refresh);

// Logout (Revoke Refresh Token)
router.post('/logout', logout);

export default router;
