'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

const list = (v) =>
  (v || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const config = {
  env,
  isProd,
  port: Number(process.env.PORT) || 3000,
  // Set TRUST_PROXY=1 when running behind nginx / a PaaS load balancer
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || true : false,

  // Used to sign login cookies. MUST be set in production.
  jwtSecret: process.env.JWT_SECRET || (isProd ? '' : 'dev-only-insecure-secret-change-me'),
  jwtExpiresDays: Number(process.env.JWT_EXPIRES_DAYS) || 7,

  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'placement.db'),
  frontendDir: process.env.FRONTEND_DIR || path.join(__dirname, '..', '..', 'frontend'),

  // Day boundaries for streaks / daily missions
  timezone: process.env.APP_TIMEZONE || 'Asia/Kolkata',

  // Optional: restrict signups to these email domains, e.g. "college.edu,iitd.ac.in"
  allowedEmailDomains: list(process.env.ALLOWED_EMAIL_DOMAINS),

  // Only needed if the frontend is hosted on a different origin than the API
  corsOrigin: list(process.env.CORS_ORIGIN),

  admin: {
    email: (process.env.ADMIN_EMAIL || '').toLowerCase(),
    password: process.env.ADMIN_PASSWORD || '',
    name: process.env.ADMIN_NAME || 'Admin',
  },
};

if (isProd && config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be set to a random string of at least 32 characters in production.');
}

module.exports = config;
