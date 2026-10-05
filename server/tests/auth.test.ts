import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../src/app';
import * as dbModule from '../src/db';

// Mock in-memory database store for tests
interface MockUser {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

let mockUsers: MockUser[] = [];

// Intercept database query calls in tests
(dbModule.db as unknown as { query: typeof dbModule.db.query }).query = (async (text: string, params: unknown[] = []) => {
  const queryStr = text.trim();

  // 1. SELECT by email
  if (queryStr.includes('SELECT id FROM users WHERE LOWER(email) = LOWER($1)') ||
      queryStr.includes('SELECT id, name, email, password_hash, created_at FROM users WHERE LOWER(email) = LOWER($1)')) {
    const emailToFind = String(params[0]).toLowerCase();
    const user = mockUsers.find((u) => u.email.toLowerCase() === emailToFind);
    return {
      rows: user ? [user] : [],
      command: 'SELECT',
      rowCount: user ? 1 : 0,
      oid: 0,
      fields: []
    };
  }

  // 2. INSERT user
  if (queryStr.includes('INSERT INTO users')) {
    const [name, email, passwordHash] = params as [string, string, string];
    // Check duplicate
    if (mockUsers.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      const err = new Error('duplicate key value violates unique constraint "users_email_key"');
      (err as unknown as { code: string }).code = '23505';
      throw err;
    }
    const newUser: MockUser = {
      id: `usr_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name,
      email,
      password_hash: passwordHash,
      created_at: new Date(),
      updated_at: new Date()
    };
    mockUsers.push(newUser);
    return {
      rows: [newUser],
      command: 'INSERT',
      rowCount: 1,
      oid: 0,
      fields: []
    };
  }

  // 3. SELECT by id (me endpoint)
  if (queryStr.includes('SELECT id, name, email, created_at FROM users WHERE id = $1')) {
    const idToFind = String(params[0]);
    const user = mockUsers.find((u) => u.id === idToFind);
    return {
      rows: user ? [user] : [],
      command: 'SELECT',
      rowCount: user ? 1 : 0,
      oid: 0,
      fields: []
    };
  }

  return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
}) as unknown as typeof dbModule.query;

describe('TaskFlow Authentication API Tests', () => {
  beforeEach(async () => {
    mockUsers = [];
    // Seed an existing test user
    const passwordHash = await bcrypt.hash('SecurePassword123', 10);
    mockUsers.push({
      id: 'usr_seeded_test',
      name: 'Existing Operator',
      email: 'operator@example.com',
      password_hash: passwordHash,
      created_at: new Date(),
      updated_at: new Date()
    });
  });

  test('GET /api/health should return 200 with service info', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.service, 'taskflow-backend');
  });

  describe('POST /api/auth/register', () => {
    test('rejects registration with short name', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'A', email: 'valid@example.com', password: 'Password123' });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /Name must be at least 2 characters/);
    });

    test('rejects registration with invalid email', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Jane Doe', email: 'invalid-email-format', password: 'Password123' });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /valid email address/);
    });

    test('rejects registration with password under 8 characters', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Jane Doe', email: 'valid@example.com', password: 'short' });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /at least 8 characters/);
    });

    test('registers a new user successfully and sets HTTP-only cookie', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Alice Smith', email: 'alice@example.com', password: 'MySecretPassword123!' });

      assert.equal(res.status, 201);
      assert.equal(res.body.user.name, 'Alice Smith');
      assert.equal(res.body.user.email, 'alice@example.com');
      assert.equal(res.body.user.password_hash, undefined); // Never return password hash!
      assert.ok(res.body.user.id);

      // Verify Set-Cookie header is present
      const cookies = res.headers['set-cookie'];
      assert.ok(cookies, 'Expected Set-Cookie header');
      const tokenCookie = (Array.isArray(cookies) ? cookies : [cookies]).find((c: string) => c.startsWith('token='));
      assert.ok(tokenCookie, 'Expected token cookie');
      assert.match(tokenCookie, /HttpOnly/i);
    });

    test('returns 409 conflict when registering with duplicate email', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Duplicate User', email: 'operator@example.com', password: 'AnotherPassword123' });

      assert.equal(res.status, 409);
      assert.match(res.body.error, /already exists/);
    });
  });

  describe('POST /api/auth/login', () => {
    test('rejects login with missing email or password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'operator@example.com' });
      assert.equal(res.status, 400);
    });

    test('returns generic 401 for non-existent email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nonexistent@example.com', password: 'RandomPassword123' });
      assert.equal(res.status, 401);
      assert.equal(res.body.error, 'Invalid email or password');
    });

    test('returns generic 401 for incorrect password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'operator@example.com', password: 'WrongPassword' });
      assert.equal(res.status, 401);
      assert.equal(res.body.error, 'Invalid email or password');
    });

    test('logs in successfully with valid credentials and sets cookie', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'operator@example.com', password: 'SecurePassword123' });

      assert.equal(res.status, 200);
      assert.equal(res.body.user.email, 'operator@example.com');
      assert.equal(res.body.user.name, 'Existing Operator');

      const cookies = res.headers['set-cookie'];
      assert.ok(cookies);
      const tokenCookie = (Array.isArray(cookies) ? cookies : [cookies]).find((c: string) => c.startsWith('token='));
      assert.ok(tokenCookie);
      assert.match(tokenCookie, /HttpOnly/i);
    });
  });

  describe('GET /api/auth/me (Protected Route)', () => {
    test('returns 401 when no token cookie or header is provided', async () => {
      const res = await request(app).get('/api/auth/me');
      assert.equal(res.status, 401);
      assert.match(res.body.error, /token is missing/);
    });

    test('returns authenticated user profile when valid cookie is provided', async () => {
      // 1. Log in to get cookie
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'operator@example.com', password: 'SecurePassword123' });

      const cookieHeader = loginRes.headers['set-cookie'];

      // 2. Call /api/auth/me with cookie
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', cookieHeader);

      assert.equal(meRes.status, 200);
      assert.equal(meRes.body.user.email, 'operator@example.com');
      assert.equal(meRes.body.user.name, 'Existing Operator');
      assert.equal(meRes.body.user.password_hash, undefined);
    });
  });

  describe('POST /api/auth/logout', () => {
    test('clears auth token cookie and returns 200', async () => {
      const res = await request(app).post('/api/auth/logout');
      assert.equal(res.status, 200);
      assert.equal(res.body.message, 'Logged out successfully');

      const cookies = res.headers['set-cookie'];
      assert.ok(cookies);
      const clearedCookie = (Array.isArray(cookies) ? cookies : [cookies]).find((c: string) => c.startsWith('token='));
      assert.ok(clearedCookie);
      // Cleared cookies typically have Max-Age=0 or Expires in the past
      assert.ok(clearedCookie.includes('Expires=') || clearedCookie.includes('Max-Age=0'));
    });
  });
});
