import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { getProfile, updateWeightUnit } from '../controllers/profileController';

const router = Router();

// Get user profile with stats
router.get('/', authenticateToken, getProfile);

// Update weight unit preference
router.post('/weight-unit', authenticateToken, updateWeightUnit);

export default router;
