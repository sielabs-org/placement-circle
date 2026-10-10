'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const db = require('../db');
const config = require('../config');
const { HttpError, wrap } = require('../utils/http');
const { publicUser } = require('../utils/user');
const { requireAuth, issueSession, clearSession } = require('../middleware/auth');

const router = express.Router();

// Keeps a record of every successful login (who + when)
db.exec(`
CREATE TABLE IF NOT EXISTS login_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const limiter = (limit, windowMinutes, message) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => config.env === 'test',
    message: { error: message },
  });
const loginLimiter = limiter(10, 15, 'Too many login attempts. Please wait a few minutes and try again.');
const signupLimiter = limiter(15, 15, 'Too many signup attempts. Please wait a few minutes and try again.');

/* ------------------------------------------------------------------ validation */
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long.')
  .pipe(z.email('Enter a valid email address.'));

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password must be at most 72 characters.')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter.')
  .regex(/[0-9]/, 'Password must contain at least one number.');

const YEARS = ['1st Year', '2nd Year', '3rd Year', 'Final Year'];

const signupSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(80),
  email,
  password,
  branch: z.string().trim().max(30).optional().default(''),
  year: z.enum(YEARS).or(z.literal('')).optional().default(''),
});
const loginSchema = z.object({ email, password: z.string().min(1, 'Enter your password.').max(200) });

/* --------------------------------------------------------------------- helpers */
// Used so "unknown email" takes as long as "wrong password" (prevents timing-based user discovery)
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

function assertDomainAllowed(mail) {
  const allowed = config.allowedEmailDomains;
  if (!allowed.length) return;
  const domain = mail.split('@')[1];
  if (!allowed.some((d) => domain === d || domain.endsWith('.' + d))) {
    throw new HttpError(400, `Please use your college email (${allowed.map((d) => '@' + d).join(', ')}).`);
  }
}

/* ---------------------------------------------------------------------- routes */

// Signup: validate the form and create the account. The user then logs in from the login page.
router.post('/signup', signupLimiter, wrap(async (req, res) => {
  const data = signupSchema.parse(req.body);
  assertDomainAllowed(data.email);

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(data.email)) {
    throw new HttpError(409, 'An account with this email already exists. Please log in instead.');
  }

  const hash = await bcrypt.hash(data.password, 10);
  let userId;
  try {
    userId = db
      .prepare('INSERT INTO users (full_name, email, password_hash, branch, year) VALUES (?, ?, ?, ?, ?)')
      .run(data.fullName, data.email, hash, data.branch, data.year).lastInsertRowid;
  } catch (err) {
    if (String(err.code).startsWith('SQLITE_CONSTRAINT')) throw new HttpError(409, 'An account with this email already exists.');
    throw err;
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  res.status(201).json({ user: publicUser(user) });
}));

router.post('/login', loginLimiter, wrap(async (req, res) => {
  const { email: mail, password: pw } = loginSchema.parse(req.body);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(mail);
  const ok = await bcrypt.compare(pw, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Invalid email or password.');
  db.prepare('INSERT INTO login_events (user_id) VALUES (?)').run(user.id);
  issueSession(res, user.id);
  res.json({ user: publicUser(user) });
}));

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;