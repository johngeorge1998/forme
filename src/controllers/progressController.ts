import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../db';
import { sendSuccess, sendError } from '../utils/response';
import { convertWeight, round } from '../utils/weight';
import { asyncHandler } from '../utils/asyncHandler';

/**
 * Helper: fetch the user's weight unit preference.
 */
const getUserWeightUnit = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { weightUnit: true },
  });
  return user?.weightUnit ?? 'KG';
};

/**
 * Calculate the user's workout streak.
 * Counts consecutive days (backward from today) with at least 1 completed workout.
 */
const calculateStreak = (workoutDates: Date[]): number => {
  if (workoutDates.length === 0) return 0;

  const uniqueDays = [
    ...new Set(
      workoutDates.map((d) => {
        const date = new Date(d);
        date.setHours(0, 0, 0, 0);
        return date.getTime();
      })
    ),
  ].sort((a, b) => b - a);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;

  const mostRecent = uniqueDays[0];
  if (todayMs - mostRecent > oneDayMs) return 0;

  let streak = 0;
  for (let i = 0; i < uniqueDays.length; i++) {
    const expectedDay = todayMs - i * oneDayMs;
    if (uniqueDays[i] === expectedDay) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
};

export const getStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Run all independent queries in parallel
  const [user, weeklyVolumeAgg, weekSessions, recentSessions, allDates] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, weightUnit: true },
    }),

    // Aggregate weekly volume at DB level — single value, no data transfer
    prisma.workoutSession.aggregate({
      where: { userId, endTime: { not: null }, startTime: { gte: oneWeekAgo } },
      _sum: { volumeKg: true, durationSec: true },
    }),

    // Only fetch sessions from last 7 days for chart data
    prisma.workoutSession.findMany({
      where: { userId, endTime: { not: null }, startTime: { gte: oneWeekAgo } },
      select: { startTime: true, volumeKg: true },
      orderBy: { startTime: 'desc' },
    }),

    // Only fetch last 3 sessions for recent activity
    prisma.workoutSession.findMany({
      where: { userId, endTime: { not: null } },
      select: { startTime: true, durationSec: true, volumeKg: true, routine: { select: { name: true } } },
      orderBy: { startTime: 'desc' },
      take: 3,
    }),

    // Minimal data for streak calculation
    prisma.workoutSession.findMany({
      where: { userId, endTime: { not: null } },
      select: { startTime: true },
      orderBy: { startTime: 'desc' },
    }),
  ]);

  const firstName = user?.fullName ? user.fullName.split(' ')[0] : 'Athlete';
  const unit = user?.weightUnit ?? 'KG';
  const weeklyVolumeKg = weeklyVolumeAgg._sum.volumeKg ?? 0;
  const focusTimeSec = weeklyVolumeAgg._sum.durationSec ?? 0;

  // Build chart data from week sessions only
  const chartData = [
    { day: 'Mon', volume: 0 }, { day: 'Tue', volume: 0 }, { day: 'Wed', volume: 0 },
    { day: 'Thu', volume: 0 }, { day: 'Fri', volume: 0 }, { day: 'Sat', volume: 0 }, { day: 'Sun', volume: 0 }
  ];

  weekSessions.forEach((s) => {
    const dayIndex = (s.startTime.getDay() + 6) % 7; // Convert Sun=0 to Mon=0
    chartData[dayIndex].volume += s.volumeKg;
  });

  // Convert chart data volumes
  const convertedChart = chartData.map((d) => ({
    ...d,
    volume: convertWeight(d.volume, unit) ?? 0,
  }));

  const streak = calculateStreak(allDates.map((w) => w.startTime));

  const recentActivity = recentSessions.map((s) => ({
    routineName: s.routine?.name || 'Freestyle Workout',
    date: s.startTime,
    durationSec: s.durationSec,
    volume: convertWeight(s.volumeKg, unit),
    weightUnit: unit,
  }));

  sendSuccess(res, {
    firstName,
    weeklyVolume: convertWeight(weeklyVolumeKg, unit),
    weightUnit: unit,
    focusTimeHours: round(focusTimeSec / 3600, 1),
    streak,
    chartData: convertedChart,
    recentActivity
  }, 'Stats fetched successfully');
});

export const get1RMHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { exerciseId } = req.params;
  const userId = req.user!.id;
  
  const [unit, exercise] = await Promise.all([
    getUserWeightUnit(userId),
    prisma.exercise.findUnique({ where: { id: exerciseId } }),
  ]);

  if (!exercise) return sendError(res, 'Exercise not found.', 404);

  const sets = await prisma.workoutSet.findMany({
    where: {
      isCompleted: true,
      workoutExercise: {
        exerciseId,
        session: { userId }
      }
    },
    include: {
      workoutExercise: { include: { session: { select: { startTime: true } } } }
    },
    orderBy: {
      workoutExercise: { session: { startTime: 'asc' } }
    }
  });

  const history = sets
    .filter((set) => set.weightKg && set.reps)
    .map((set) => {
      const est1RM = set.weightKg! * (1 + set.reps! / 30);
      return {
        date: set.workoutExercise.session.startTime,
        est1RM: round(convertWeight(est1RM, unit)!, 1),
        weight: convertWeight(set.weightKg!, unit),
        reps: set.reps,
        weightUnit: unit,
      };
    });

  sendSuccess(res, history, '1RM history fetched successfully');
});

export const getExerciseStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { exerciseId } = req.params;
  const userId = req.user!.id;

  const [unit, exercise] = await Promise.all([
    getUserWeightUnit(userId),
    prisma.exercise.findUnique({ where: { id: exerciseId } }),
  ]);

  if (!exercise) return sendError(res, 'Exercise not found.', 404);

  const sets = await prisma.workoutSet.findMany({
    where: {
      isCompleted: true,
      workoutExercise: {
        exerciseId,
        session: { userId }
      }
    },
    include: {
      workoutExercise: { include: { session: { select: { startTime: true } } } }
    }
  });

  let currentMaxKg = 0;
  let est1RMKg = 0;
  let totalReps = 0;
  let maxTimeSeconds = 0;
  let maxDistance = 0;
  let prDate: Date | null = null;

  sets.forEach((set) => {
    if (set.reps) totalReps += set.reps;
    
    if (set.weightKg && set.weightKg > 0 && set.reps && set.reps > 0) {
      if (set.weightKg > currentMaxKg) {
        currentMaxKg = set.weightKg;
        prDate = set.workoutExercise.session.startTime;
      }

      const est1rm = set.weightKg * (1 + set.reps / 30);
      if (est1rm > est1RMKg) {
        est1RMKg = est1rm;
      }
    } else if (set.timeSeconds && set.timeSeconds > maxTimeSeconds) {
      maxTimeSeconds = set.timeSeconds;
      if (!currentMaxKg && !maxDistance) prDate = set.workoutExercise.session.startTime;
    } else if (set.distance && set.distance > maxDistance) {
      maxDistance = set.distance;
      if (!currentMaxKg && !maxTimeSeconds) prDate = set.workoutExercise.session.startTime;
    }
  });

  sendSuccess(res, {
    currentMax: convertWeight(currentMaxKg, unit),
    est1RM: round(convertWeight(est1RMKg, unit)!, 1),
    maxTimeSeconds,
    maxDistance,
    totalReps,
    prDate,
    weightUnit: unit,
  }, 'Exercise stats fetched successfully');
});

export const getRecords = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const [unit, sets] = await Promise.all([
    getUserWeightUnit(userId),
    prisma.workoutSet.findMany({
      where: {
        isCompleted: true,
        workoutExercise: { session: { userId } }
      },
      include: {
        workoutExercise: { 
          include: { 
            session: { select: { startTime: true } },
            exercise: { select: { name: true } }
          } 
        }
      }
    }),
  ]);

  const maxRecordsMap = new Map<string, any>();

  sets.forEach((set) => {
    const exId = set.workoutExercise.exerciseId;
    const currentMax = maxRecordsMap.get(exId);
    
    if (set.weightKg && set.weightKg > 0 && set.reps && set.reps > 0) {
      if (!currentMax || !currentMax.weightKg || set.weightKg > currentMax.weightKg) {
        maxRecordsMap.set(exId, {
          type: 'weight',
          exerciseName: set.workoutExercise.exercise.name,
          reps: set.reps,
          weightKg: set.weightKg,
          dateAchieved: set.workoutExercise.session.startTime,
          score: set.weightKg // for sorting
        });
      }
    } else if (set.timeSeconds && set.timeSeconds > 0) {
      if (!currentMax || !currentMax.timeSeconds || set.timeSeconds > currentMax.timeSeconds) {
        maxRecordsMap.set(exId, {
          type: 'time',
          exerciseName: set.workoutExercise.exercise.name,
          timeSeconds: set.timeSeconds,
          dateAchieved: set.workoutExercise.session.startTime,
          score: set.timeSeconds
        });
      }
    } else if (set.distance && set.distance > 0) {
      if (!currentMax || !currentMax.distance || set.distance > currentMax.distance) {
        maxRecordsMap.set(exId, {
          type: 'distance',
          exerciseName: set.workoutExercise.exercise.name,
          distance: set.distance,
          dateAchieved: set.workoutExercise.session.startTime,
          score: set.distance
        });
      }
    }
  });

  const records = Array.from(maxRecordsMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((r) => ({
      type: r.type,
      exerciseName: r.exerciseName,
      reps: r.reps,
      weight: r.weightKg ? convertWeight(r.weightKg, unit) : undefined,
      weightUnit: r.weightKg ? unit : undefined,
      timeSeconds: r.timeSeconds,
      distance: r.distance,
      dateAchieved: r.dateAchieved,
    }));

  sendSuccess(res, records, 'Records fetched successfully');
});
