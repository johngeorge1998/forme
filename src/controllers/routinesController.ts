import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../db';
import { sendSuccess, sendError } from '../utils/response';
import { convertWeight, round } from '../utils/weight';
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

/**
 * Fetch the best PR (estimated 1RM via Epley formula) for each exercise ID
 * belonging to the given user. Returns a Map<exerciseId, PR>.
 */
const getExercisePRs = async (exerciseIds: string[], userId: string, unit: string) => {
  if (exerciseIds.length === 0) return new Map();

  const sets = await prisma.workoutSet.findMany({
    where: {
      isCompleted: true,
      weightKg: { gt: 0 },
      workoutExercise: {
        exerciseId: { in: exerciseIds },
        session: { userId }
      }
    },
    include: {
      workoutExercise: {
        include: { session: { select: { startTime: true } } }
      }
    }
  });

  const resultMap = new Map<string, {
    pr: { weight: number | null; reps: number | null; timeSeconds: number | null; distance: number | null; date: Date };
    est1RM: number;
  }>();

  sets.forEach((set) => {
    // If it's a rep-based exercise with weight, compute est1RM and track PR by weight.
    // If it's time-based or distance-based, est1RM remains 0, and PR is tracked by max time/distance.
    const exId = set.workoutExercise.exerciseId;
    const current = resultMap.get(exId);
    
    let isNewPR = false;
    let newEst1RM = current ? current.est1RM : 0;

    if (set.weightKg && set.weightKg > 0 && set.reps && set.reps > 0) {
      // Rep-based PR logic
      const est1RM = set.weightKg * (1 + set.reps / 30);
      const est1RMConverted = round(convertWeight(est1RM, unit as any)!, 1);
      if (!current || est1RMConverted > current.est1RM) {
        newEst1RM = est1RMConverted;
      }
      if (!current || !current.pr.weight || set.weightKg > current.pr.weight) {
        isNewPR = true;
      }
    } else if (set.timeSeconds && set.timeSeconds > 0) {
      // Time-based PR logic
      if (!current || !current.pr.timeSeconds || set.timeSeconds > current.pr.timeSeconds) {
        isNewPR = true;
      }
    } else if (set.distance && set.distance > 0) {
      // Distance-based PR logic
      if (!current || !current.pr.distance || set.distance > current.pr.distance) {
        isNewPR = true;
      }
    }

    if (!current || isNewPR || newEst1RM > current.est1RM) {
      resultMap.set(exId, {
        pr: isNewPR
          ? {
              weight: convertWeight(set.weightKg, unit as any),
              reps: set.reps,
              timeSeconds: set.timeSeconds,
              distance: set.distance,
              date: set.workoutExercise.session.startTime,
            }
          : current!.pr,
        est1RM: newEst1RM,
      });
    }
  });

  return resultMap;
};

export const getRoutines = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const [unit, routines] = await Promise.all([
    getUserWeightUnit(userId),
    prisma.routine.findMany({
      where: { userId },
      include: {
        exercises: {
          include: { exercise: true },
          orderBy: { order: 'asc' }
        },
        workouts: {
          orderBy: { startTime: 'desc' },
          take: 1, // Only need the most recent workout to determine lastPerformedAt
          select: { startTime: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    }),
  ]);

  // Collect all unique exercise IDs across all routines
  const allExerciseIds = [...new Set(
    routines.flatMap(r => r.exercises.map(ex => ex.exerciseId))
  )];

  // Single batch query for all PRs and est1RMs
  const recordsMap = await getExercisePRs(allExerciseIds, userId, unit);

  // Map to include lastPerformedAt, PR, and est1RM data cleanly for frontend
  const mappedRoutines = routines.map(routine => ({
    ...routine,
    lastPerformedAt: routine.workouts.length > 0 ? routine.workouts[0].startTime : null,
    workouts: undefined, // remove the workouts array from response to keep it clean
    exercises: routine.exercises.map(ex => {
      const records = recordsMap.get(ex.exerciseId);
      return {
        ...ex,
        pr: records?.pr || null,
        est1RM: records?.est1RM || null,
        weightUnit: unit,
      };
    }),
  }));

  sendSuccess(res, mappedRoutines, 'Routines fetched successfully');
});

export const createRoutine = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, notes, automaticRestTimer, exercises } = req.body;

  if (!name) {
    return sendError(res, 'Routine name is required.', 400);
  }

  const routine = await prisma.routine.create({
    data: {
      name,
      notes,
      automaticRestTimer: automaticRestTimer ?? true,
      userId: req.user!.id,
      exercises: {
        create: exercises?.map((ex: any, idx: number) => ({
          exerciseId: ex.exerciseId,
          order: ex.order ?? idx,
          targetSets: ex.targetSets || 1,
          targetReps: ex.targetReps,
          targetTimeSeconds: ex.targetTimeSeconds,
          targetDistance: ex.targetDistance,
          restSeconds: ex.restSeconds
        })) || []
      }
    },
    include: { exercises: true }
  });

  sendSuccess(res, routine, 'Routine created successfully', 201);
});

export const updateRoutine = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { name, notes, automaticRestTimer, exercises } = req.body;

  const existingRoutine = await prisma.routine.findFirst({
    where: { id, userId: req.user!.id }
  });

  if (!existingRoutine) {
    return sendError(res, 'Routine not found.', 404);
  }

  // Wrap delete + recreate in a transaction for atomicity.
  // If the create fails, the delete is rolled back — no orphaned routines.
  const updatedRoutine = await prisma.$transaction(async (tx) => {
    await tx.routineExercise.deleteMany({
      where: { routineId: id }
    });

    return tx.routine.update({
      where: { id },
      data: {
        name,
        notes,
        automaticRestTimer: automaticRestTimer ?? true,
        exercises: {
          create: exercises?.map((ex: any, idx: number) => ({
            exerciseId: ex.exerciseId,
            order: ex.order ?? idx,
            targetSets: ex.targetSets || 1,
            targetReps: ex.targetReps,
            targetTimeSeconds: ex.targetTimeSeconds,
            targetDistance: ex.targetDistance,
            restSeconds: ex.restSeconds
          })) || []
        }
      },
      include: { exercises: true }
    });
  });

  sendSuccess(res, updatedRoutine, 'Routine updated successfully');
});

export const getRoutineById = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const [unit, routine] = await Promise.all([
    getUserWeightUnit(userId),
    prisma.routine.findFirst({
      where: { id: req.params.id, userId },
      include: {
        exercises: {
          include: { exercise: true },
          orderBy: { order: 'asc' }
        }
      }
    }),
  ]);

  if (!routine) return sendError(res, 'Routine not found.', 404);

  const exerciseIds = routine.exercises.map(ex => ex.exerciseId);
  const recordsMap = await getExercisePRs(exerciseIds, userId, unit);

  const mappedRoutine = {
    ...routine,
    exercises: routine.exercises.map(ex => {
      const records = recordsMap.get(ex.exerciseId);
      return {
        ...ex,
        pr: records?.pr || null,
        est1RM: records?.est1RM || null,
        weightUnit: unit,
      };
    }),
  };

  sendSuccess(res, mappedRoutine, 'Routine fetched successfully');
});

export const deleteRoutine = asyncHandler(async (req: AuthRequest, res: Response) => {
  const existingRoutine = await prisma.routine.findFirst({
    where: { id: req.params.id, userId: req.user!.id }
  });

  if (!existingRoutine) {
    return sendError(res, 'Routine not found.', 404);
  }

  // Cascade delete handles child RoutineExercises automatically
  await prisma.routine.delete({
    where: { id: req.params.id }
  });

  sendSuccess(res, null, 'Routine deleted successfully');
});
