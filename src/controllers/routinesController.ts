import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../db';
import { sendSuccess, sendError } from '../utils/response';

export const getRoutines = async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (error) {
    sendError(res, 'Failed to fetch routines', 500);
  }
};

export const createRoutine = async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (error) {
    sendError(res, 'Failed to create routine', 500);
  }
};

export const updateRoutine = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, notes, automaticRestTimer, exercises } = req.body;

    const existingRoutine = await prisma.routine.findFirst({
      where: { id, userId: req.user!.id }
    });

    if (!existingRoutine) {
      return sendError(res, 'Routine not found.', 404);
    }

    // Delete existing exercises first
    await prisma.routineExercise.deleteMany({
      where: { routineId: id }
    });

    const updatedRoutine = await prisma.routine.update({
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

    sendSuccess(res, updatedRoutine, 'Routine updated successfully');
  } catch (error) {
    sendError(res, 'Failed to update routine', 500);
  }
};

export const getRoutineById = async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (error) {
    sendError(res, 'Failed to fetch routine', 500);
  }
};

export const deleteRoutine = async (req: AuthRequest, res: Response) => {
  try {
    const existingRoutine = await prisma.routine.findFirst({
      where: { id: req.params.id, userId: req.user!.id }
    });

    if (!existingRoutine) {
      return sendError(res, 'Routine not found.', 404);
    }

    await prisma.routineExercise.deleteMany({
      where: { routineId: req.params.id }
    });
    
    await prisma.routine.delete({
      where: { id: req.params.id }
    });

    sendSuccess(res, null, 'Routine deleted successfully');
  } catch (error) {
    sendError(res, 'Failed to delete routine', 500);
  }
};
