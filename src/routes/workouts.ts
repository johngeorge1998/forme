import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  getAllWorkouts,
  getWorkoutById,
  startWorkout,
  updateSet,
  addExerciseToWorkout,
  addSetToExercise,
  removeExerciseFromWorkout,
  removeSetFromExercise,
  saveExerciseNotes,
  finishWorkout
} from '../controllers/workoutsController';

const router = Router();

// Get all workouts (history)
router.get('/', authenticateToken, getAllWorkouts);

// Get workout details
router.get('/:id', authenticateToken, getWorkoutById);

// Start a workout
router.post('/', authenticateToken, startWorkout);

// Add exercise mid-workout
router.post('/:id/workout-exercises', authenticateToken, addExerciseToWorkout);

// Add set to an exercise
router.post('/:id/workout-exercises/:workoutExerciseId/sets', authenticateToken, addSetToExercise);

// Delete an exercise from workout
router.delete('/:id/workout-exercises/:workoutExerciseId', authenticateToken, removeExerciseFromWorkout);

// Save exercise notes
router.put('/:id/workout-exercises/:workoutExerciseId', authenticateToken, saveExerciseNotes);

// Log or update a set
router.put('/:id/sets/:setId', authenticateToken, updateSet);

// Delete a set
router.delete('/:id/sets/:setId', authenticateToken, removeSetFromExercise);

// Finish workout
router.post('/:id/finish', authenticateToken, finishWorkout);

export default router;
