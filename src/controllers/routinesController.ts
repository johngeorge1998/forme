import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../db';
import { sendSuccess, sendError } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';

export const getRoutines = asyncHandler(async (req: AuthRequest, res: Response) => {
  const routines = await prisma.routine.findMany({
    where: { userId: req.user!.id },
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
  });
  
  // Map to include lastPerformedAt cleanly for frontend
  const mappedRoutines = routines.map(routine => ({
    ...routine,
    lastPerformedAt: routine.workouts.length > 0 ? routine.workouts[0].startTime : null,
    workouts: undefined // remove the workouts array from response to keep it clean
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
  const routine = await prisma.routine.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    include: {
      exercises: {
        include: { exercise: true },
        orderBy: { order: 'asc' }
      }
    }
  });

  if (!routine) return sendError(res, 'Routine not found.', 404);
  sendSuccess(res, routine, 'Routine fetched successfully');
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
