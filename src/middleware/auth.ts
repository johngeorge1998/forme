import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthRequest } from '../types';
import { sendError } from '../utils/response';

export { AuthRequest };

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return sendError(res, 'Access token missing', 401);
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as { id: string; email: string; gender?: string };
    req.user = decoded;
    next();
  } catch {
    return sendError(res, 'Invalid or expired token', 403);
  }
};
