import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  getRoutines,
  createRoutine,
  updateRoutine,
  getRoutineById,
  deleteRoutine
} from '../controllers/routinesController';

const router = Router();

// Get user routines
router.get('/', authenticateToken, getRoutines);

// Create new routine
router.post('/', authenticateToken, createRoutine);

// Update routine
router.put('/:id', authenticateToken, updateRoutine);

// Get single routine
router.get('/:id', authenticateToken, getRoutineById);

// Delete routine
router.delete('/:id', authenticateToken, deleteRoutine);

export default router;
