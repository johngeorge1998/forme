import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  getStats,
  get1RMHistory,
  getExerciseStats,
  getRecords
} from '../controllers/progressController';

const router = Router();

// Get aggregated stats
router.get('/stats', authenticateToken, getStats);

// Get specific exercise stats
router.get('/exercise-stats/:exerciseId', authenticateToken, getExerciseStats);

// Get historical 1RM for an exercise
router.get('/1rm/:exerciseId', authenticateToken, get1RMHistory);

// Get Personal Records
router.get('/records', authenticateToken, getRecords);

export default router;
