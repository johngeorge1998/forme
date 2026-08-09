import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../db';
import { WeightUnit } from '@prisma/client';
import { sendSuccess, sendError } from '../utils/response';
import { convertWeight, getUnitLabel } from '../utils/weight';
import { asyncHandler } from '../utils/asyncHandler';

/**
 * Calculate the user's current workout streak.
 * Counts consecutive days (backward from today) where the user
 * completed at least one workout.
 */
const calculateStreak = (workoutDates: Date[]): number => {
  if (workoutDates.length === 0) return 0;

  // Deduplicate by calendar date (YYYY-MM-DD), sorted descending
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

  let streak = 0;

  // The most recent workout must be today or yesterday to count as an active streak
  const mostRecent = uniqueDays[0];
  if (todayMs - mostRecent > oneDayMs) return 0;

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

/**
 * GET /api/v1/profile
 * Returns user profile with aggregated stats.
 */
export const getProfile = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  // Run independent queries in parallel for speed
  const [user, totalWorkouts, volumeAgg, workoutDates] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, email: true, weightUnit: true },
    }),

    prisma.workoutSession.count({
      where: { userId, endTime: { not: null } },
    }),

    prisma.workoutSession.aggregate({
      where: { userId, endTime: { not: null } },
      _sum: { volumeKg: true },
    }),

    // Fetch only startTime for streak calculation — minimal data transfer
    prisma.workoutSession.findMany({
      where: { userId, endTime: { not: null } },
      select: { startTime: true },
      orderBy: { startTime: 'desc' },
    }),
  ]);

  if (!user) {
    return sendError(res, 'User not found', 404);
  }

  const totalVolumeKg = volumeAgg._sum.volumeKg ?? 0;
  const streakDays = calculateStreak(workoutDates.map((w) => w.startTime));
  const unit = user.weightUnit;

  sendSuccess(
    res,
    {
      fullName: user.fullName,
      email: user.email,
      weightUnit: unit,
      totalWorkouts,
      streakDays,
      totalVolume: convertWeight(totalVolumeKg, unit),
      volumeUnit: getUnitLabel(unit),
    },
    'Profile fetched successfully'
  );
});

/**
 * POST /api/v1/profile/weight-unit
 * Update the user's preferred weight unit (KG or LBS).
 */
export const updateWeightUnit = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { weightUnit } = req.body;

  if (!weightUnit || !['KG', 'LBS'].includes(weightUnit)) {
    return sendError(res, 'Invalid weight unit. Must be "KG" or "LBS".', 400);
  }

  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { weightUnit: weightUnit as WeightUnit },
    select: { id: true, weightUnit: true },
  });

  sendSuccess(res, user, 'Weight unit updated successfully');
});
