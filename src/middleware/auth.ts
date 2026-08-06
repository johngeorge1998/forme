import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import { sendError } from '../utils/response';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-replace-me-in-production';

export interface AuthRequest extends Request {
  user?: { id: string; email: string; gender?: string };
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return sendError(res, 'Access token missing', 401);
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return sendError(res, 'Invalid or expired token', 403);
    }
    req.user = user as any;
    next();
  });
};
