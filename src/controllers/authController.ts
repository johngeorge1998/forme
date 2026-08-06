import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../db';
import { Gender } from '@prisma/client';

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
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    
    let userGender = Gender.UNSPECIFIED;
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

    res.status(201).json({ 
      token: tokens.accessToken, 
      refreshToken: tokens.refreshToken,
      user: { id: user.id, email: user.email, fullName: user.fullName, gender: user.gender } 
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const tokens = await generateTokens(user);

    res.json({ 
      token: tokens.accessToken, 
      refreshToken: tokens.refreshToken,
      user: { id: user.id, email: user.email, fullName: user.fullName, gender: user.gender } 
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const refresh = async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token is required' });
  }

  try {
    // Verify token mathematically
    const payload = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET) as { id: string };

    // Verify token exists in database (and hasn't expired in DB)
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken }
    });

    if (!storedToken) {
      return res.status(403).json({ error: 'Invalid or revoked refresh token' });
    }

    if (new Date() > storedToken.expiresAt) {
      await prisma.refreshToken.delete({ where: { id: storedToken.id } });
      return res.status(403).json({ error: 'Refresh token has expired' });
    }

    // Get fresh user data
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate NEW tokens (rotate refresh token)
    // Delete the old refresh token first
    await prisma.refreshToken.delete({ where: { id: storedToken.id } });

    const newTokens = await generateTokens(user);

    res.json({
      token: newTokens.accessToken,
      refreshToken: newTokens.refreshToken
    });
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired refresh token' });
  }
};

export const logout = async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  try {
    // Attempt to delete it from the database to revoke it
    await prisma.refreshToken.deleteMany({
      where: { token: refreshToken }
    });

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
