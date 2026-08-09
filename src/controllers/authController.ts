import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../db';
import { Gender } from '@prisma/client';
import { config } from '../config';
import { sendSuccess, sendError } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';

const generateTokens = async (user: { id: string; email: string; gender: string }) => {
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, gender: user.gender },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpiresIn }
  );

  const refreshToken = jwt.sign(
    { id: user.id },
    config.jwt.refreshSecret,
    { expiresIn: `${config.jwt.refreshExpiresInDays}d` }
  );

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.jwt.refreshExpiresInDays);

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt,
    }
  });

  return { accessToken, refreshToken };
};

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { fullName, email, password, gender } = req.body;
  
  if (!email || !password) {
    return sendError(res, 'Email and password are required', 400);
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return sendError(res, 'User already exists', 409);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  
  let userGender: Gender = Gender.UNSPECIFIED;
  if (gender && (gender === 'MALE' || gender === 'FEMALE')) {
    userGender = gender as Gender;
  }

  const user = await prisma.user.create({
    data: {
      fullName,
      email,
      passwordHash,
      gender: userGender,
    },
  });

  const tokens = await generateTokens(user);

  sendSuccess(res, { 
    token: tokens.accessToken, 
    refreshToken: tokens.refreshToken,
    user: { id: user.id, email: user.email, fullName: user.fullName, gender: user.gender, weightUnit: user.weightUnit } 
  }, 'User registered successfully', 201);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    return sendError(res, 'Invalid email or password', 401);
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    return sendError(res, 'Invalid email or password', 401);
  }

  const tokens = await generateTokens(user);

  sendSuccess(res, { 
    token: tokens.accessToken, 
    refreshToken: tokens.refreshToken,
    user: { id: user.id, email: user.email, fullName: user.fullName, gender: user.gender, weightUnit: user.weightUnit } 
  }, 'Login successful');
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return sendError(res, 'Refresh token is required', 401);
  }

  // Verify token signature
  const payload = jwt.verify(refreshToken, config.jwt.refreshSecret) as { id: string };

  // Verify token exists in database (and hasn't expired in DB)
  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: refreshToken }
  });

  if (!storedToken) {
    return sendError(res, 'Invalid or revoked refresh token', 403);
  }

  if (new Date() > storedToken.expiresAt) {
    await prisma.refreshToken.delete({ where: { id: storedToken.id } });
    return sendError(res, 'Refresh token has expired', 403);
  }

  // Get fresh user data
  const user = await prisma.user.findUnique({ where: { id: payload.id } });
  if (!user) {
    return sendError(res, 'User not found', 404);
  }

  // Rotate refresh token: delete old, generate new
  await prisma.refreshToken.delete({ where: { id: storedToken.id } });

  const newTokens = await generateTokens(user);

  sendSuccess(res, {
    token: newTokens.accessToken,
    refreshToken: newTokens.refreshToken
  }, 'Tokens refreshed successfully');
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return sendError(res, 'Refresh token is required', 400);
  }

  // Revoke the refresh token by deleting it from the database
  await prisma.refreshToken.deleteMany({
    where: { token: refreshToken }
  });

  sendSuccess(res, null, 'Logged out successfully');
});
