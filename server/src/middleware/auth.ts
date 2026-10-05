import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

// Extend Express Request to hold the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  // Check HTTP-only cookie first, then fallback to Bearer token in Authorization header
  let token = req.cookies?.token;

  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  if (!token) {
    res.status(401).json({
      error: 'Unauthorized. Authentication token is missing.'
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthUser;
    req.user = {
      id: decoded.id,
      name: decoded.name,
      email: decoded.email
    };
    next();
  } catch {
    res.status(401).json({
      error: 'Unauthorized. Session is invalid or has expired.'
    });
  }
};
