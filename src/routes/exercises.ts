import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { getExercises, getExerciseById, createExercise, updateExercise, deleteExercise } from '../controllers/exercisesController';

const router = Router();

// Get all exercises with optional filters
router.get('/', authenticateToken, getExercises);

// Get single exercise detail
router.get('/:id', authenticateToken, getExerciseById);

// Custom Exercise Routes
router.post('/', authenticateToken, createExercise);
router.put('/:id', authenticateToken, updateExercise);
router.delete('/:id', authenticateToken, deleteExercise);

export default router;
