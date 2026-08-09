import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../db';
import { sendSuccess, sendError } from '../utils/response';
import { convertWeight } from '../utils/weight';
import { asyncHandler } from '../utils/asyncHandler';

/**
 * Helper: fetch the user's weight unit preference.
 * Returns 'KG' if user not found (safe default).
 */
const getUserWeightUnit = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { weightUnit: true },
  });
  return user?.weightUnit ?? 'KG';
};

export const getAllWorkouts = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { limit = 20, offset = 0 } = req.query;

  const [unit, total, workouts] = await Promise.all([
    getUserWeightUnit(userId),
    prisma.workoutSession.count({ where: { userId } }),
    prisma.workoutSession.findMany({
      where: { userId },
      orderBy: { startTime: 'desc' },
      take: Number(limit),
      skip: Number(offset),
      include: {
        routine: { select: { name: true } },
        exercises: {
          include: {
            exercise: { select: { name: true, thumbnails: true } }
          }
        }
      }
    }),
  ]);

  const converted = workouts.map((w) => ({
    ...w,
    volume: convertWeight(w.volumeKg, unit),
    weightUnit: unit,
  }));

  const hasNext = (Number(offset) + converted.length) < total;

  sendSuccess(res, converted, 'Workouts fetched successfully', 200, {
    total,
    limit: Number(limit),
    offset: Number(offset),
    hasNext,
  });
});

export const getWorkoutById = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const [unit, workout] = await Promise.all([
    getUserWeightUnit(userId),
    prisma.workoutSession.findFirst({
      where: { id: req.params.id, userId },
      include: {
        routine: { select: { name: true, id: true } },
        exercises: {
          orderBy: { order: 'asc' },
          include: {
            exercise: true,
            sets: { orderBy: { setNumber: 'asc' } }
          }
        }
      }
    }),
  ]);

  if (!workout) {
    return sendError(res, 'Workout not found', 404);
  }

  const converted = {
    ...workout,
    volume: convertWeight(workout.volumeKg, unit),
    weightUnit: unit,
    exercises: workout.exercises.map((ex) => ({
      ...ex,
      sets: ex.sets.map((set) => ({
        ...set,
        weight: convertWeight(set.weightKg, unit),
        weightUnit: unit,
      })),
    })),
  };

  sendSuccess(res, converted, 'Workout fetched successfully');
});

export const startWorkout = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { routineId, notes, exercises, startTime } = req.body;

  let exercisesToCreate = exercises || [];

  if (routineId && (!exercises || exercises.length === 0)) {
    const routine = await prisma.routine.findFirst({ 
      where: { id: routineId, userId: req.user!.id },
      include: { exercises: true } 
    });
    if (!routine) return sendError(res, 'Routine not found.', 404);

    // Auto-populate based on routine template
    exercisesToCreate = routine.exercises.map((rx) => {
      const setsToCreate = [];
      for (let i = 0; i < rx.targetSets; i++) {
        setsToCreate.push({ setNumber: i + 1 });
      }
      return {
        exerciseId: rx.exerciseId,
        order: rx.order,
        sets: setsToCreate
      };
    });
  }

  const session = await prisma.workoutSession.create({
    data: {
      userId: req.user!.id,
      routineId,
      notes,
      ...(startTime && { startTime: new Date(startTime) }),
      exercises: {
        create: exercisesToCreate.map((ex: any, idx: number) => ({
          exerciseId: ex.exerciseId,
          order: ex.order !== undefined ? ex.order : idx,
          sets: {
            create: ex.sets?.map((set: any, sIdx: number) => ({
              setNumber: set.setNumber || sIdx + 1,
              weightKg: set.weightKg || null,
              reps: set.reps || null,
              isCompleted: set.isCompleted || false
            })) || []
          }
        })) || []
      }
    },
    include: { exercises: { include: { sets: true } } }
  });

  sendSuccess(res, session, 'Workout started successfully', 201);
});

export const updateSet = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { weightKg, reps, isCompleted } = req.body;
  
  if (weightKg !== undefined && weightKg < 0) return sendError(res, 'Weight must be positive.', 400);
  if (reps !== undefined && reps < 0) return sendError(res, 'Reps must be positive.', 400);

  const session = await prisma.workoutSession.findFirst({
    where: { id: req.params.id, userId: req.user!.id }
  });
  if (!session) return sendError(res, 'Workout session not found.', 404);

  const updatedSet = await prisma.workoutSet.update({
    where: { id: req.params.setId },
    data: { weightKg, reps, isCompleted }
  });

  sendSuccess(res, updatedSet, 'Set updated successfully');
});

export const addExerciseToWorkout = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { exerciseId, order } = req.body;

  const session = await prisma.workoutSession.findFirst({
    where: { id: req.params.id, userId: req.user!.id }
  });
  if (!session) return sendError(res, 'Workout session not found.', 404);

  const exercise = await prisma.exercise.findUnique({ where: { id: exerciseId } });
  if (!exercise) return sendError(res, 'Exercise not found.', 404);

  const workoutExercise = await prisma.workoutExercise.create({
    data: {
      sessionId: req.params.id,
      exerciseId,
      order: order ?? 0,
      sets: {
        create: [{ setNumber: 1 }] // Automatically create the first empty set
      }
    },
    include: { sets: true }
  });

  sendSuccess(res, workoutExercise, 'Exercise added to workout', 201);
});

export const addSetToExercise = asyncHandler(async (req: AuthRequest, res: Response) => {
  const session = await prisma.workoutSession.findFirst({
    where: { id: req.params.id, userId: req.user!.id }
  });
  if (!session) return sendError(res, 'Workout session not found.', 404);

  const workoutExercise = await prisma.workoutExercise.findFirst({
    where: { id: req.params.workoutExerciseId, sessionId: req.params.id },
    include: { sets: true }
  });
  if (!workoutExercise) return sendError(res, 'Workout exercise not found.', 404);

  const nextSetNumber = workoutExercise.sets.length + 1;

  const newSet = await prisma.workoutSet.create({
    data: {
      workoutExerciseId: workoutExercise.id,
      setNumber: nextSetNumber,
    }
  });

  sendSuccess(res, newSet, 'Set added successfully', 201);
});

export const removeExerciseFromWorkout = asyncHandler(async (req: AuthRequest, res: Response) => {
  const session = await prisma.workoutSession.findFirst({
    where: { id: req.params.id, userId: req.user!.id }
  });
  if (!session) return sendError(res, 'Workout session not found.', 404);

  const workoutExercise = await prisma.workoutExercise.findFirst({
    where: { id: req.params.workoutExerciseId, sessionId: req.params.id }
  });
  if (!workoutExercise) return sendError(res, 'Workout exercise not found.', 404);

  // Cascade delete handles child WorkoutSets automatically
  await prisma.workoutExercise.delete({
    where: { id: workoutExercise.id }
  });

  sendSuccess(res, null, 'Exercise deleted successfully');
});

export const removeSetFromExercise = asyncHandler(async (req: AuthRequest, res: Response) => {
  const session = await prisma.workoutSession.findFirst({
    where: { id: req.params.id, userId: req.user!.id }
  });
  if (!session) return sendError(res, 'Workout session not found.', 404);

  const workoutSet = await prisma.workoutSet.findFirst({
    where: { id: req.params.setId, workoutExercise: { sessionId: req.params.id } }
  });
  if (!workoutSet) return sendError(res, 'Workout set not found.', 404);

  await prisma.workoutSet.delete({
    where: { id: req.params.setId }
  });

  sendSuccess(res, null, 'Set deleted successfully');
});

export const saveExerciseNotes = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { notes } = req.body;

  const session = await prisma.workoutSession.findFirst({
    where: { id: req.params.id, userId: req.user!.id }
  });
  if (!session) return sendError(res, 'Workout session not found.', 404);

  const workoutExercise = await prisma.workoutExercise.findFirst({
    where: { id: req.params.workoutExerciseId, sessionId: req.params.id }
  });
  if (!workoutExercise) return sendError(res, 'Workout exercise not found.', 404);

  const updated = await prisma.workoutExercise.update({
    where: { id: req.params.workoutExerciseId },
    data: { notes }
  });

  sendSuccess(res, updated, 'Notes saved successfully');
});

export const finishWorkout = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { endTime, durationSec, notes } = req.body;
  const userId = req.user!.id;
  
  const [unit, session] = await Promise.all([
    getUserWeightUnit(userId),
    prisma.workoutSession.findFirst({
      where: { id: req.params.id, userId },
      include: { exercises: { include: { sets: true } } }
    }),
  ]);

  if (!session) return sendError(res, 'Workout session not found.', 404);
  if (session.endTime) return sendError(res, 'Workout is already finished.', 400);

  const end = endTime ? new Date(endTime) : new Date();
  const finalDurationSec = durationSec !== undefined ? durationSec : Math.floor((end.getTime() - session.startTime.getTime()) / 1000);

  let totalVolume = 0;
  session.exercises.forEach((ex) => {
    ex.sets.forEach((set) => {
      if (set.isCompleted && set.weightKg && set.reps) {
        totalVolume += set.weightKg * set.reps;
      }
    });
  });

  const updatedSession = await prisma.workoutSession.update({
    where: { id: session.id },
    data: {
      endTime: end,
      durationSec: finalDurationSec,
      volumeKg: totalVolume,
      ...(notes !== undefined && { notes })
    }
  });

  sendSuccess(res, {
    ...updatedSession,
    volume: convertWeight(updatedSession.volumeKg, unit),
    weightUnit: unit,
  }, 'Workout finished successfully');
});
