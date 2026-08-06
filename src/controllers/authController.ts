import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../db';
import { Gender } from '@prisma/client';
import { sendSuccess, sendError } from '../utils/response';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-replace-me-in-production';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'super-secret-refresh-key-replace-me-in-production';

const generateTokens = async (user: any) => {
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, gender: user.gender },
    JWT_SECRET,
    { expiresIn: '15m' } // Short-lived access token
  );

  const refreshToken = jwt.sign(
    { id: user.id },
    REFRESH_TOKEN_SECRET,
    { expiresIn: '30d' } // Long-lived refresh token
  );

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt,
    }
  });

  return { accessToken, refreshToken };
};

export const register = async (req: Request, res: Response) => {
  try {
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
      user: { id: user.id, email: user.email, fullName: user.fullName, gender: user.gender } 
    }, 'User registered successfully', 201);
  } catch (error) {
    sendError(res, 'Internal server error', 500);
  }
};

export const login = async (req: Request, res: Response) => {
  try {
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
      user: { id: user.id, email: user.email, fullName: user.fullName, gender: user.gender } 
    }, 'Login successful');
  } catch (error) {
    sendError(res, 'Internal server error', 500);
  }
};

export const refresh = async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return sendError(res, 'Refresh token is required', 401);
  }

  try {
    // Verify token mathematically
    const payload = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET) as { id: string };

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

    // Generate NEW tokens (rotate refresh token)
    // Delete the old refresh token first
    await prisma.refreshToken.delete({ where: { id: storedToken.id } });

    const newTokens = await generateTokens(user);

    sendSuccess(res, {
      token: newTokens.accessToken,
      refreshToken: newTokens.refreshToken
    }, 'Tokens refreshed successfully');
  } catch (error) {
    return sendError(res, 'Invalid or expired refresh token', 403);
  }
};

export const logout = async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return sendError(res, 'Refresh token is required', 400);
  }

  try {
    // Attempt to delete it from the database to revoke it
    await prisma.refreshToken.deleteMany({
      where: { token: refreshToken }
    });

    sendSuccess(res, null, 'Logged out successfully');
  } catch (error) {
    sendError(res, 'Internal server error', 500);
  }
};
