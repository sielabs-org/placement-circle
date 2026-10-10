'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');

// SQLite ships inside Node itself (node:sqlite), so nothing needs compiling on install.
// Silence only the "experimental" notice for it; other warnings still show.
const origEmit = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  const msg = typeof w === 'string' ? w : (w && w.message) || '';
  if (/SQLite is an experimental feature/i.test(msg)) return;
  return origEmit.call(process, w, ...rest);
};
const { DatabaseSync } = require('node:sqlite');
process.emitWarning = origEmit;

/**
 * Small adapter so the rest of the code can use db.prepare / db.exec /
 * db.pragma / db.transaction exactly like before.
 */
class Database {
  constructor(file) {
    this.raw = new DatabaseSync(file);
    this.depth = 0;
  }
  exec(sql) { return this.raw.exec(sql); }
  prepare(sql) {
    const stmt = this.raw.prepare(sql);
    const names = [...new Set([...sql.matchAll(/[@:$]([A-Za-z_]\w*)/g)].map((m) => m[1]))];
    // node:sqlite rejects object keys the SQL doesn't use; better-sqlite3 ignored them.
    const clean = (args) => {
      if (args.length !== 1) return args;
      const a = args[0];
      if (!a || typeof a !== 'object' || Array.isArray(a) || Buffer.isBuffer(a)) return args;
      const out = {};
      for (const n of names) if (n in a) out[n] = a[n];
      return [out];
    };
    return {
      run: (...a) => stmt.run(...clean(a)),
      get: (...a) => stmt.get(...clean(a)),
      all: (...a) => stmt.all(...clean(a)),
    };
  }
  pragma(text) { this.raw.exec('PRAGMA ' + text); }
  transaction(fn) {
    return (...args) => {
      if (this.depth > 0) return fn(...args);   // already inside a transaction
      this.raw.exec('BEGIN');
      this.depth++;
      try {
        const result = fn(...args);
        this.raw.exec('COMMIT');
        return result;
      } catch (err) {
        this.raw.exec('ROLLBACK');
        throw err;
      } finally {
        this.depth--;
      }
    };
  }
}

if (config.dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
}

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name       TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin')),
  college         TEXT NOT NULL DEFAULT '',
  branch          TEXT NOT NULL DEFAULT '',
  year            TEXT NOT NULL DEFAULT '',
  goal            TEXT NOT NULL DEFAULT '',
  level           TEXT NOT NULL DEFAULT '',
  focus           TEXT NOT NULL DEFAULT '[]',
  target_companies TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN ('DSA','Aptitude','HR')),
  topic        TEXT NOT NULL,
  difficulty   TEXT NOT NULL CHECK (difficulty IN ('Easy','Medium','Hard')),
  time_minutes INTEGER NOT NULL,
  companies    TEXT NOT NULL DEFAULT '[]',
  description  TEXT NOT NULL DEFAULT '',
  hint         TEXT NOT NULL DEFAULT '',
  options      TEXT,            -- JSON array for MCQ questions, else NULL
  answer       TEXT,            -- correct option for MCQ questions, else NULL
  explanation  TEXT NOT NULL DEFAULT '',
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (title, category)
);

CREATE TABLE IF NOT EXISTS attempts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id    INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  correct        INTEGER NOT NULL CHECK (correct IN (0,1)),
  answer         TEXT,
  time_spent_sec INTEGER,
  day            TEXT NOT NULL,   -- YYYY-MM-DD in the app timezone
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_user_day ON attempts(user_id, day);
CREATE INDEX IF NOT EXISTS idx_attempts_user_q   ON attempts(user_id, question_id);

-- Every point a user earns. UNIQUE makes awards idempotent (no double points).
CREATE TABLE IF NOT EXISTS points_ledger (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points     INTEGER NOT NULL,
  reason     TEXT NOT NULL,      -- 'solve' | 'daily_bonus'
  ref        TEXT NOT NULL,      -- question id or day
  day        TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, reason, ref)
);
CREATE INDEX IF NOT EXISTS idx_points_user ON points_ledger(user_id);

CREATE TABLE IF NOT EXISTS daily_sets (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day          TEXT NOT NULL,
  question_ids TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS opportunities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  company     TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('internship','job')),
  location    TEXT NOT NULL,
  pay         TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  eligibility TEXT NOT NULL DEFAULT '',
  link        TEXT NOT NULL,
  deadline    TEXT NOT NULL,     -- YYYY-MM-DD (last day to apply)
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (title, company)
);

CREATE TABLE IF NOT EXISTS experiences (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  company    TEXT NOT NULL,
  role       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'Offer' CHECK (status IN ('Offer','Rejected','In process')),
  name       TEXT NOT NULL,
  year       INTEGER NOT NULL,
  rounds     TEXT NOT NULL DEFAULT '[]',
  tip        TEXT NOT NULL,
  full       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company, role, name, year)
);

CREATE TABLE IF NOT EXISTS experience_helpful (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  experience_id INTEGER NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, experience_id)
);
`);

module.exports = db;
