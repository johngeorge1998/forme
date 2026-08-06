import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../db';

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
    res.json(workouts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch workouts' });
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
      return res.status(404).json({ error: 'Workout not found' });
    }

    res.json(workout);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch workout details' });
  }
};

export const startWorkout = async (req: AuthRequest, res: Response) => {
  try {
    const { routineId, notes, exercises } = req.body;

    let exercisesToCreate = exercises || [];

    if (routineId && (!exercises || exercises.length === 0)) {
      const routine = await prisma.routine.findFirst({ 
        where: { id: routineId, userId: req.user!.id },
        include: { exercises: true } 
      });
      if (!routine) return res.status(404).json({ error: 'Routine not found.' });

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
    res.status(201).json(session);
  } catch (error) {
    res.status(500).json({ error: 'Failed to start workout' });
  }
};

export const updateSet = async (req: AuthRequest, res: Response) => {
  try {
    const { weightKg, reps, isCompleted } = req.body;
    
    if (weightKg !== undefined && weightKg < 0) return res.status(400).json({ error: 'Weight must be positive.' });
    if (reps !== undefined && reps < 0) return res.status(400).json({ error: 'Reps must be positive.' });

    const session = await prisma.workoutSession.findFirst({
      where: { id: req.params.id, userId: req.user!.id }
    });
    if (!session) return res.status(404).json({ error: 'Workout session not found.' });

    const updatedSet = await prisma.workoutSet.update({
      where: { id: req.params.setId },
      data: { weightKg, reps, isCompleted }
    });

    res.json(updatedSet);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update set' });
  }
};

export const addExerciseToWorkout = async (req: AuthRequest, res: Response) => {
  try {
    const { exerciseId, order } = req.body;

    const session = await prisma.workoutSession.findFirst({
      where: { id: req.params.id, userId: req.user!.id }
    });
    if (!session) return res.status(404).json({ error: 'Workout session not found.' });

    const exercise = await prisma.exercise.findUnique({ where: { id: exerciseId } });
    if (!exercise) return res.status(404).json({ error: 'Exercise not found.' });

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

    res.status(201).json(workoutExercise);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add exercise to workout' });
  }
};

export const addSetToExercise = async (req: AuthRequest, res: Response) => {
  try {
    const session = await prisma.workoutSession.findFirst({
      where: { id: req.params.id, userId: req.user!.id }
    });
    if (!session) return res.status(404).json({ error: 'Workout session not found.' });

    const workoutExercise = await prisma.workoutExercise.findFirst({
      where: { id: req.params.workoutExerciseId, sessionId: req.params.id },
      include: { sets: true }
    });
    if (!workoutExercise) return res.status(404).json({ error: 'Workout exercise not found.' });

    const nextSetNumber = workoutExercise.sets.length + 1;

    const newSet = await prisma.workoutSet.create({
      data: {
        workoutExerciseId: workoutExercise.id,
        setNumber: nextSetNumber,
      }
    });

    res.status(201).json(newSet);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add set' });
  }
};

export const removeExerciseFromWorkout = async (req: AuthRequest, res: Response) => {
  try {
    const session = await prisma.workoutSession.findFirst({
      where: { id: req.params.id, userId: req.user!.id }
    });
    if (!session) return res.status(404).json({ error: 'Workout session not found.' });

    const workoutExercise = await prisma.workoutExercise.findFirst({
      where: { id: req.params.workoutExerciseId, sessionId: req.params.id }
    });
    if (!workoutExercise) return res.status(404).json({ error: 'Workout exercise not found.' });

    // Manually delete child sets to prevent foreign key errors (cascade)
    await prisma.workoutSet.deleteMany({
      where: { workoutExerciseId: workoutExercise.id }
    });

    await prisma.workoutExercise.delete({
      where: { id: workoutExercise.id }
    });

    res.json({ message: 'Exercise deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete exercise' });
  }
};

export const removeSetFromExercise = async (req: AuthRequest, res: Response) => {
  try {
    const session = await prisma.workoutSession.findFirst({
      where: { id: req.params.id, userId: req.user!.id }
    });
    if (!session) return res.status(404).json({ error: 'Workout session not found.' });

    const workoutSet = await prisma.workoutSet.findFirst({
      where: { id: req.params.setId, workoutExercise: { sessionId: req.params.id } }
    });
    if (!workoutSet) return res.status(404).json({ error: 'Workout set not found.' });

    await prisma.workoutSet.delete({
      where: { id: req.params.setId }
    });

    res.json({ message: 'Set deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete set' });
  }
};

export const saveExerciseNotes = async (req: AuthRequest, res: Response) => {
  try {
    const { notes } = req.body;

    const session = await prisma.workoutSession.findFirst({
      where: { id: req.params.id, userId: req.user!.id }
    });
    if (!session) return res.status(404).json({ error: 'Workout session not found.' });

    const workoutExercise = await prisma.workoutExercise.findFirst({
      where: { id: req.params.workoutExerciseId, sessionId: req.params.id }
    });
    if (!workoutExercise) return res.status(404).json({ error: 'Workout exercise not found.' });

    const updated = await prisma.workoutExercise.update({
      where: { id: req.params.workoutExerciseId },
      data: { notes }
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save notes' });
  }
};

export const finishWorkout = async (req: AuthRequest, res: Response) => {
  try {
    const { endTime } = req.body;
    
    const session = await prisma.workoutSession.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: { exercises: { include: { sets: true } } }
    });

    if (!session) return res.status(404).json({ error: 'Workout session not found.' });
    if (session.endTime) return res.status(400).json({ error: 'Workout is already finished.' });

    const end = endTime ? new Date(endTime) : new Date();
    const durationSec = Math.floor((end.getTime() - session.startTime.getTime()) / 1000);

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
        durationSec,
        volumeKg: totalVolume
      }
    });

    res.json(updatedSession);
  } catch (error) {
    res.status(500).json({ error: 'Failed to finish workout' });
  }
};
