import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { getExercises, getExerciseById } from '../controllers/exercisesController';

const router = Router();

// Get all exercises with optional filters
router.get('/', authenticateToken, getExercises);

// Get single exercise detail
router.get('/:id', authenticateToken, getExerciseById);

export default router;
