import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../db';
import { sendSuccess, sendError } from '../utils/response';

export const getStats = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const firstName = user?.fullName ? user.fullName.split(' ')[0] : 'Athlete';
    
    const sessions = await prisma.workoutSession.findMany({
      where: { userId, endTime: { not: null } },
      orderBy: { startTime: 'desc' },
      include: { routine: true }
    });

    let weeklyVolume = 0;
    let focusTimeSec = 0;
    
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const chartData = [
      { day: 'Mon', volume: 0 }, { day: 'Tue', volume: 0 }, { day: 'Wed', volume: 0 },
      { day: 'Thu', volume: 0 }, { day: 'Fri', volume: 0 }, { day: 'Sat', volume: 0 }, { day: 'Sun', volume: 0 }
    ];

    sessions.forEach(s => {
      focusTimeSec += (s.durationSec || 0);
      if (s.startTime >= oneWeekAgo) {
        weeklyVolume += s.volumeKg;
        
        // Populate chart data (very simplistic day grouping for demo)
        const dayIndex = (s.startTime.getDay() + 6) % 7; // Convert Sun=0 to Mon=0
        chartData[dayIndex].volume += s.volumeKg;
      }
    });

    // Simple streak calculation (just checking if they worked out recently)
    const streak = sessions.length > 0 ? 12 : 0; // Hardcoded 12 for UI demo, real logic requires sequential date checking

    const recentActivity = sessions.slice(0, 3).map(s => ({
      routineName: s.routine?.name || 'Freestyle Workout',
      date: s.startTime,
      durationSec: s.durationSec,
      volumeKg: s.volumeKg
    }));

    sendSuccess(res, {
      firstName,
      weeklyVolume,
      focusTimeHours: (focusTimeSec / 3600).toFixed(1),
      streak,
      chartData,
      recentActivity
    }, 'Stats fetched successfully');
  } catch (error) {
    sendError(res, 'Failed to fetch stats', 500);
  }
};

export const get1RMHistory = async (req: AuthRequest, res: Response) => {
  try {
    const { exerciseId } = req.params;
    
    const exercise = await prisma.exercise.findUnique({ where: { id: exerciseId } });
    if (!exercise) return sendError(res, 'Exercise not found.', 404);

    const sets = await prisma.workoutSet.findMany({
      where: {
        isCompleted: true,
        workoutExercise: {
          exerciseId,
          session: { userId: req.user!.id }
        }
      },
      include: {
        workoutExercise: { include: { session: true } }
      },
      orderBy: {
        workoutExercise: { session: { startTime: 'asc' } }
      }
    });

    const history: any[] = [];
    sets.forEach((set: any) => {
      if (set.weightKg && set.reps) {
        const est1RM = set.weightKg * (1 + set.reps / 30);
        history.push({
          date: set.workoutExercise.session.startTime,
          est1RM: parseFloat(est1RM.toFixed(1)),
          weightKg: set.weightKg,
          reps: set.reps
        });
      }
    });

    sendSuccess(res, history, '1RM history fetched successfully');
  } catch (error) {
    sendError(res, 'Failed to fetch 1RM history', 500);
  }
};

export const getExerciseStats = async (req: AuthRequest, res: Response) => {
  try {
    const { exerciseId } = req.params;

    const exercise = await prisma.exercise.findUnique({ where: { id: exerciseId } });
    if (!exercise) return sendError(res, 'Exercise not found.', 404);

    const sets = await prisma.workoutSet.findMany({
      where: {
        isCompleted: true,
        workoutExercise: {
          exerciseId,
          session: { userId: req.user!.id }
        }
      },
      include: {
        workoutExercise: { include: { session: true } }
      }
    });

    let currentMaxKg = 0;
    let est1RMKg = 0;
    let totalReps = 0;
    let prDate: Date | null = null;

    sets.forEach((set: any) => {
      if (set.reps) totalReps += set.reps;
      
      if (set.weightKg && set.reps) {
        if (set.weightKg > currentMaxKg) {
          currentMaxKg = set.weightKg;
          prDate = set.workoutExercise.session.startTime;
        }

        const est1rm = set.weightKg * (1 + set.reps / 30);
        if (est1rm > est1RMKg) {
          est1RMKg = est1rm;
        }
      }
    });

    sendSuccess(res, {
      currentMaxKg,
      est1RMKg: parseFloat(est1RMKg.toFixed(1)),
      totalReps,
      prDate
    }, 'Exercise stats fetched successfully');
  } catch (error) {
    sendError(res, 'Failed to fetch exercise stats', 500);
  }
};

export const getRecords = async (req: AuthRequest, res: Response) => {
  try {
    // Find all max sets grouped by exercise for the user
    // A simple approach in Prisma is fetching completed sets and manually finding the max
    
    const sets = await prisma.workoutSet.findMany({
      where: {
        isCompleted: true,
        weightKg: { gt: 0 },
        workoutExercise: { session: { userId: req.user!.id } }
      },
      include: {
        workoutExercise: { 
          include: { 
            session: true,
            exercise: true
          } 
        }
      }
    });

    const maxRecordsMap = new Map<string, any>();

    sets.forEach((set: any) => {
      const exId = set.workoutExercise.exerciseId;
      const currentMax = maxRecordsMap.get(exId);
      
      if (!currentMax || set.weightKg > currentMax.weightKg) {
        maxRecordsMap.set(exId, {
          exerciseName: set.workoutExercise.exercise.name,
          reps: set.reps,
          weightKg: set.weightKg,
          dateAchieved: set.workoutExercise.session.startTime
        });
      }
    });

    // Return the top 3 records for demo purposes, or all
    const records = Array.from(maxRecordsMap.values())
      .sort((a, b) => b.weightKg - a.weightKg)
      .slice(0, 3);

    sendSuccess(res, records, 'Records fetched successfully');
  } catch (error) {
    sendError(res, 'Failed to fetch records', 500);
  }
};
