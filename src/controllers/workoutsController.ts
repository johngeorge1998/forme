import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../db';
import { sendSuccess, sendError } from '../utils/response';

export const getAllWorkouts = async (req: AuthRequest, res: Response) => {
  try {
    const workouts = await prisma.workoutSession.findMany({
      where: { userId: req.user!.id },
      orderBy: { startTime: 'desc' },
      include: {
        routine: { select: { name: true } },
        exercises: {
          include: {
            exercise: { select: { name: true, thumbnails: true } }
          }
        }
      }
    });
    sendSuccess(res, workouts, 'Workouts fetched successfully');
  } catch (error) {
    sendError(res, 'Failed to fetch workouts', 500);
  }
};

export const getWorkoutById = async (req: AuthRequest, res: Response) => {
  try {
    const workout = await prisma.workoutSession.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
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
    });

    if (!workout) {
      return sendError(res, 'Workout not found', 404);
    }

    sendSuccess(res, workout, 'Workout fetched successfully');
  } catch (error) {
    sendError(res, 'Failed to fetch workout details', 500);
  }
};

export const startWorkout = async (req: AuthRequest, res: Response) => {
  try {
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
          setsToCreate.push({
            setNumber: i + 1,
          });
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
  } catch (error) {
    sendError(res, 'Failed to start workout', 500);
  }
};

export const updateSet = async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (error) {
    sendError(res, 'Failed to update set', 500);
  }
};

export const addExerciseToWorkout = async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (error) {
    sendError(res, 'Failed to add exercise to workout', 500);
  }
};

export const addSetToExercise = async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (error) {
    sendError(res, 'Failed to add set', 500);
  }
};

export const removeExerciseFromWorkout = async (req: AuthRequest, res: Response) => {
  try {
    const session = await prisma.workoutSession.findFirst({
      where: { id: req.params.id, userId: req.user!.id }
    });
    if (!session) return sendError(res, 'Workout session not found.', 404);

    const workoutExercise = await prisma.workoutExercise.findFirst({
      where: { id: req.params.workoutExerciseId, sessionId: req.params.id }
    });
    if (!workoutExercise) return sendError(res, 'Workout exercise not found.', 404);

    // Manually delete child sets to prevent foreign key errors (cascade)
    await prisma.workoutSet.deleteMany({
      where: { workoutExerciseId: workoutExercise.id }
    });

    await prisma.workoutExercise.delete({
      where: { id: workoutExercise.id }
    });

    sendSuccess(res, null, 'Exercise deleted successfully');
  } catch (error) {
    sendError(res, 'Failed to delete exercise', 500);
  }
};

export const removeSetFromExercise = async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (error) {
    sendError(res, 'Failed to delete set', 500);
  }
};

export const saveExerciseNotes = async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (error) {
    sendError(res, 'Failed to save notes', 500);
  }
};

export const finishWorkout = async (req: AuthRequest, res: Response) => {
  try {
    const { endTime, durationSec, notes } = req.body;
    
    const session = await prisma.workoutSession.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: { exercises: { include: { sets: true } } }
    });

    if (!session) return sendError(res, 'Workout session not found.', 404);
    if (session.endTime) return sendError(res, 'Workout is already finished.', 400);

    const end = endTime ? new Date(endTime) : new Date();
    const finalDurationSec = durationSec !== undefined ? durationSec : Math.floor((end.getTime() - session.startTime.getTime()) / 1000);

    let totalVolume = 0;
    session.exercises.forEach((ex: any) => {
      ex.sets.forEach((set: any) => {
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

    sendSuccess(res, updatedSession, 'Workout finished successfully');
  } catch (error) {
    sendError(res, 'Failed to finish workout', 500);
  }
};
