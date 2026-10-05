import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { db } from '../db';
import { AuthUser } from '../middleware/auth';
import { writeLog } from '../logger';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_EXPIRY = '7d';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

interface UserRow {
  id: string;
  name: string;
  display_name?: string | null;
  email: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

const getDisplayName = (user: Pick<UserRow, 'display_name' | 'email'>): string => {
  const displayName = user.display_name?.trim();
  if (displayName) return displayName;
  const emailName = user.email.split('@', 1)[0]?.trim();
  return emailName || 'User';
};

const getCookieOptions = () => ({
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'lax' as const,
  maxAge: COOKIE_MAX_AGE,
  path: '/'
});

const generateToken = (user: AuthUser): string => {
  return jwt.sign(
    { id: user.id, name: user.name, displayName: user.displayName, email: user.email },
    config.jwtSecret,
    { expiresIn: TOKEN_EXPIRY }
  );
};

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { displayName: requestedDisplayName, name, email, password } = req.body;
    const displayNameInput = requestedDisplayName ?? name;

    // 1. Input Validation
    if (typeof displayNameInput !== 'string' || !displayNameInput.trim()) {
      res.status(400).json({ error: 'Display name is required' });
      return;
    }

    const trimmedDisplayName = displayNameInput.trim();
    const displayNameLength = Array.from(trimmedDisplayName).length;
    if (displayNameLength > 50) {
      res.status(400).json({ error: 'Display name must be 50 characters or fewer' });
      return;
    }
    if (requestedDisplayName == null && displayNameLength < 2) {
      res.status(400).json({ error: 'Display name must be at least 2 characters long' });
      return;
    }

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      res.status(400).json({ error: 'Please provide a valid email address' });
      return;
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters long' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedName = trimmedDisplayName;

    // 2. Check for duplicate email before insert
    const existingUser = await db.query<UserRow>(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [normalizedEmail]
    );

    if (existingUser.rows.length > 0) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    // 3. Hash password using bcryptjs
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 4. Insert user using parameterized SQL
    const insertResult = await db.query<UserRow>(
      `INSERT INTO users (name, display_name, email, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, display_name, email, created_at`,
      [trimmedName, trimmedDisplayName, normalizedEmail, passwordHash]
    );

    const newUser = insertResult.rows[0];
    const userPayload: AuthUser = {
      id: newUser.id,
      name: newUser.name,
      displayName: getDisplayName(newUser),
      email: newUser.email
    };

    // 5. Generate JWT and issue secure HTTP-only cookie
    const token = generateToken(userPayload);
    res.cookie('token', token, getCookieOptions());

    res.status(201).json({
      message: 'Account registered successfully',
      user: {
        id: newUser.id,
        name: newUser.name,
        displayName: getDisplayName(newUser),
        email: newUser.email,
        createdAt: newUser.created_at
      }
    });
  } catch (err: unknown) {
    // Handle Postgres unique constraint violation fallback (code 23505)
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505') {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    writeLog('api', 'error', 'registration_failed', { error: err });
    res.status(500).json({ error: 'Failed to register account. Please try again later.' });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Query user by normalized email
    const result = await db.query<UserRow>(
      'SELECT id, name, display_name, email, password_hash, created_at FROM users WHERE LOWER(email) = LOWER($1)',
      [normalizedEmail]
    );

    const user = result.rows[0];

    // Generic error to prevent email enumeration attacks
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const userPayload: AuthUser = {
      id: user.id,
      name: user.name,
      displayName: getDisplayName(user),
      email: user.email
    };

    const token = generateToken(userPayload);
    res.cookie('token', token, getCookieOptions());

    res.status(200).json({
      message: 'Logged in successfully',
      user: {
        id: user.id,
        name: user.name,
        displayName: getDisplayName(user),
        email: user.email,
        createdAt: user.created_at
      }
    });
  } catch (err: unknown) {
    writeLog('api', 'error', 'login_failed', { error: err });
    res.status(500).json({ error: 'Failed to process login. Please try again later.' });
  }
};

export const logout = (_req: Request, res: Response): void => {
  // Clear the authentication cookie
  res.clearCookie('token', {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/'
  });

  res.status(200).json({ message: 'Logged out successfully' });
};

export const me = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Verify user still exists in database and get fresh info
    const result = await db.query<UserRow>(
      'SELECT id, name, display_name, email, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    const user = result.rows[0];
    if (!user) {
      res.status(401).json({ error: 'User no longer exists' });
      return;
    }

    res.status(200).json({
      user: {
        id: user.id,
        name: user.name,
        displayName: getDisplayName(user),
        email: user.email,
        createdAt: user.created_at
      }
    });
  } catch (err: unknown) {
    writeLog('api', 'error', 'auth_me_failed', { error: err });
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
};
