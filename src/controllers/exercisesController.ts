import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../db';
import { sendSuccess, sendError } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';

const formatMediaPaths = (mediaObj: any, type: 'videos' | 'thumbnails', userGender?: string) => {
  if (!mediaObj || typeof mediaObj !== 'object') return [];
  
  // Default to MALE if unspecified or not provided
  const preferredGender = (userGender && userGender !== 'UNSPECIFIED') 
    ? userGender.toLowerCase() 
    : 'male';

  // Find best match in the JSON object (e.g. { "male": "url", "female": "url" })
  let originalUrl = mediaObj[preferredGender];
  let actualGenderUsed = preferredGender;

  // Fallback if missing
  if (!originalUrl) {
    originalUrl = mediaObj['male'] || Object.values(mediaObj)[0];
    actualGenderUsed = mediaObj['male'] ? 'male' : 'unknown';
  }

  if (typeof originalUrl === 'string') {
    // For Vercel deployment, we return the direct Cloudflare R2 public URL
    // instead of local paths since Vercel cannot host large media files.
    return [originalUrl];
  }

  return [];
};

export const getExercises = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { search, muscleGroup, equipment, limit = 50, offset = 0 } = req.query;

  const where: any = {};
  if (search) {
    where.name = { contains: String(search), mode: 'insensitive' };
  }
  if (muscleGroup) {
    where.bodyPart = { equals: String(muscleGroup), mode: 'insensitive' };
  }

  const [total, exercises] = await Promise.all([
    prisma.exercise.count({ where }),
    prisma.exercise.findMany({
      where,
      take: Number(limit),
      skip: Number(offset),
    }),
  ]);

  const userGender = req.user?.gender;

  const formattedExercises = exercises.map(ex => ({
    ...ex,
    videos: formatMediaPaths(ex.videos, 'videos', userGender),
    thumbnails: formatMediaPaths(ex.thumbnails, 'thumbnails', userGender)
  }));

  const hasNext = (Number(offset) + formattedExercises.length) < total;

  sendSuccess(res, formattedExercises, 'Exercises fetched successfully', 200, {
    total,
    limit: Number(limit),
    offset: Number(offset),
    hasNext
  });
});

export const getExerciseById = asyncHandler(async (req: AuthRequest, res: Response) => {
  const exercise = await prisma.exercise.findUnique({
    where: { id: req.params.id }
  });

  if (!exercise) return sendError(res, 'Exercise not found', 404);
  
  const userGender = req.user?.gender;

  const formattedExercise = {
    ...exercise,
    videos: formatMediaPaths(exercise.videos, 'videos', userGender),
    thumbnails: formatMediaPaths(exercise.thumbnails, 'thumbnails', userGender)
  };

  sendSuccess(res, formattedExercise, 'Exercise fetched successfully');
});
