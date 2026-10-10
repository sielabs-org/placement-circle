'use strict';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.ADMIN_EMAIL = 'admin@college.edu';
process.env.ADMIN_PASSWORD = 'Admin@12345';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../src/app');
const seed = require('../src/seed');
const db = require('../src/db');
const stats = require('../src/services/stats');
const { today, addDays } = require('../src/utils/dates');

let server;
let base;

/** Tiny fetch wrapper with its own cookie jar (one per simulated browser). */
function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) {
      const pair = c.split(';')[0];
      cookie = pair.endsWith('=') ? '' : pair; // cleared cookie => logged out
    }
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: json };
  };
  return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p) };
}

async function signup(c, name, email, extra = {}) {
  const r = await c.post('/api/auth/signup', { fullName: name, email, password: 'Secret123', branch: 'CSE', year: 'Final Year', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.user;
}

before(async () => {
  seed.run();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

/* ----------------------------------------------------------------------- auth */
test('health works and API requires login', async () => {
  const c = client();
  assert.equal((await c.get('/api/health')).status, 200);
  assert.equal((await c.get('/api/questions')).status, 401);
  assert.equal((await c.get('/api/dashboard')).status, 401);
  assert.equal((await c.get('/api/nope')).status, 401, 'unknown API paths do not reveal anything when logged out');
  await signup(c, 'Not Found Tester', 'nf@college.edu');
  assert.equal((await c.get('/api/nope')).status, 404);
});

test('signup: validation, instant account + login, duplicate email', async () => {
  const c = client();
  const weak = await c.post('/api/auth/signup', { fullName: 'Riya Shah', email: 'riya@college.edu', password: 'short' });
  assert.equal(weak.status, 400);

  const done = await c.post('/api/auth/signup', { fullName: 'Riya Shah', email: 'Riya@College.edu', password: 'Secret123', branch: 'IT', year: '3rd Year' });
  assert.equal(done.status, 201, 'account is created immediately, no OTP step');
  assert.equal(done.body.user.email, 'riya@college.edu');
  assert.equal(done.body.user.initials, 'RS');
  assert.equal(done.body.user.subtitle, 'IT · 3rd Year');
  assert.equal(done.body.user.passwordHash, undefined);

  assert.equal((await c.get('/api/auth/me')).body.user.fullName, 'Riya Shah', 'user is logged in right after signup');

  const dup = await client().post('/api/auth/signup', { fullName: 'Riya Again', email: 'riya@college.edu', password: 'Secret123' });
  assert.equal(dup.status, 409);

  const oldRoute = await client().post('/api/auth/signup/request-otp', { fullName: 'X Y', email: 'x@college.edu', password: 'Secret123' });
  assert.equal(oldRoute.status, 401, 'the old OTP routes no longer exist');
});

test('login / logout', async () => {
  const c = client();
  await signup(c, 'Login Tester', 'login@college.edu');
  const c2 = client();
  assert.equal((await c2.post('/api/auth/login', { email: 'login@college.edu', password: 'Wrong123' })).status, 401);
  assert.equal((await c2.post('/api/auth/login', { email: 'ghost@college.edu', password: 'Secret123' })).status, 401);
  const ok = await c2.post('/api/auth/login', { email: 'LOGIN@college.edu', password: 'Secret123' });
  assert.equal(ok.status, 200);
  assert.equal((await c2.get('/api/auth/me')).status, 200);
  await c2.post('/api/auth/logout');
  assert.equal((await c2.get('/api/auth/me')).status, 401);
});

/* ------------------------------------------------------------ questions / daily */
test('questions: list, filter, search, detail never leaks the answer', async () => {
  const c = client();
  await signup(c, 'Q Tester', 'q@college.edu');
  const all = await c.get('/api/questions');
  assert.equal(all.body.count, 14);
  assert.equal((await c.get('/api/questions?category=DSA')).body.count, 6);
  assert.equal((await c.get('/api/questions?difficulty=Hard')).body.count, 2);
  assert.equal((await c.get('/api/questions?q=amazon')).body.questions.every((q) => q.companies.includes('Amazon')), true);
  assert.equal((await c.get('/api/questions?category=Nope')).status, 400);

  const apt = all.body.questions.find((q) => q.title === 'Train Speed Problem');
  const detail = await c.get(`/api/questions/${apt.id}`);
  assert.equal(detail.body.question.type, 'mcq');
  assert.equal(detail.body.question.options.length, 4);
  assert.equal(JSON.stringify(detail.body).includes('54 km/h') && detail.body.question.answer !== undefined, false);
  assert.equal(detail.body.question.answer, undefined);
});

test('attempts: MCQ grading, no answer leak on wrong, points awarded once', async () => {
  const c = client();
  const user = await signup(c, 'Grader', 'grader@college.edu');
  const q = db.prepare("SELECT id FROM questions WHERE title = 'Train Speed Problem'").get();

  const bad = await c.post(`/api/questions/${q.id}/attempt`, { answer: '45 km/h' });
  assert.equal(bad.body.correct, false);
  assert.equal(bad.body.pointsAwarded, 0);
  assert.equal(bad.body.correctAnswer, null);
  assert.equal(bad.body.explanation, null);

  assert.equal((await c.post(`/api/questions/${q.id}/attempt`, { answer: 'not an option' })).status, 400);
  assert.equal((await c.post(`/api/questions/${q.id}/attempt`, {})).status, 400);

  const good = await c.post(`/api/questions/${q.id}/attempt`, { answer: '54 km/h' });
  assert.equal(good.body.correct, true);
  assert.equal(good.body.pointsAwarded, 10); // Easy
  assert.equal(good.body.correctAnswer, '54 km/h');
  assert.ok(good.body.explanation);

  const again = await c.post(`/api/questions/${q.id}/attempt`, { answer: '54 km/h' });
  assert.equal(again.body.pointsAwarded, 0, 'no points farming');
  assert.equal(stats.getPoints(user.id), 10);
});

test('daily mission: 3 questions, stable within a day, bonus awarded once', async () => {
  const c = client();
  const user = await signup(c, 'Daily Doer', 'daily@college.edu');
  const d1 = await c.get('/api/daily');
  assert.equal(d1.body.total, 3);
  assert.deepEqual(d1.body.questions.map((q) => q.category), ['DSA', 'Aptitude', 'HR']);
  assert.equal(d1.body.completed, 0);
  const d1b = await c.get('/api/daily');
  assert.deepEqual(d1b.body.questions.map((q) => q.id), d1.body.questions.map((q) => q.id), 'same set all day');

  let last;
  for (const q of d1.body.questions) {
    const row = db.prepare('SELECT answer FROM questions WHERE id = ?').get(q.id);
    last = await c.post(`/api/questions/${q.id}/attempt`, row.answer ? { answer: row.answer } : { solved: true });
    assert.equal(last.body.correct, true);
  }
  assert.equal(last.body.mission.done, true);
  assert.equal(last.body.bonusAwarded, 20);

  const d2 = await c.get('/api/daily');
  assert.equal(d2.body.completed, 3);
  assert.equal(d2.body.done, true);

  // re-submitting must not pay the bonus a second time
  const q0 = d1.body.questions[0];
  const rep = await c.post(`/api/questions/${q0.id}/attempt`, { solved: true });
  assert.equal(rep.body.bonusAwarded, 0);
  const ledger = db.prepare("SELECT COUNT(*) n FROM points_ledger WHERE user_id = ? AND reason = 'daily_bonus'").get(user.id).n;
  assert.equal(ledger, 1);
});

/* --------------------------------------------------- progress/profile/dashboard */
test('progress, profile and dashboard reflect real activity', async () => {
  const c = client();
  const user = await signup(c, 'Stats Student', 'stats@college.edu');

  let empty = await c.get('/api/progress');
  assert.equal(empty.body.stats.prepScore, 0);
  assert.equal(empty.body.stats.solved, 0);
  assert.equal(empty.body.weekly.length, 7);

  const dsa = db.prepare("SELECT id FROM questions WHERE category = 'DSA' ORDER BY id").all();
  // 3 attempts on Arrays: 1 right, 2 wrong -> 33% => weak area
  const arrays = db.prepare("SELECT id FROM questions WHERE topic = 'Arrays'").all();
  await c.post(`/api/questions/${arrays[0].id}/attempt`, { solved: true });
  await c.post(`/api/questions/${arrays[1].id}/attempt`, { solved: false });
  await c.post(`/api/questions/${arrays[1].id}/attempt`, { solved: false });
  assert.ok(dsa.length > 0);

  const p = await c.get('/api/progress');
  assert.equal(p.body.stats.solved, 1);
  assert.equal(p.body.stats.accuracy, 33);
  assert.equal(p.body.stats.streak, 1);
  assert.ok(p.body.stats.prepScore > 0);
  assert.equal(p.body.categoryAccuracy.find((x) => x.name === 'DSA').value, 33);
  assert.equal(p.body.difficulty.find((x) => x.name === 'Easy').value, 1);
  assert.equal(p.body.weakAreas[0].name, 'Arrays');
  assert.equal(p.body.weekly.reduce((s, d) => s + d.value, 0), 1);

  const prof = await c.get('/api/profile');
  assert.equal(prof.body.heatmap.cells.length, 24 * 7);
  assert.equal(prof.body.heatmap.cells.filter((x) => x.date === today())[0].count, 3);
  assert.equal(prof.body.achievements.length, 6);
  assert.equal(prof.body.achievements.some((a) => a.unlocked), false);

  const upd = await c.put('/api/profile', { college: 'IIT Delhi', goal: 'Software Engineering', level: 'Intermediate', focus: ['DSA', 'HR'], targetCompanies: ['Google', 'Adobe'] });
  assert.equal(upd.status, 200);
  assert.deepEqual(upd.body.targetCompanies, ['Google', 'Adobe']);
  assert.equal(upd.body.user.college, 'IIT Delhi');
  assert.equal((await c.put('/api/profile', { level: 'Wizard' })).status, 400);

  const dash = await c.get('/api/dashboard');
  assert.equal(dash.status, 200);
  assert.equal(dash.body.mission.total, 3);
  assert.equal(dash.body.streak.last35Days.length, 35);
  assert.equal(dash.body.streak.last35Days[34], true);
  assert.match(dash.body.picks.coach, /Stats/);
  assert.ok(dash.body.picks.items.some((i) => /Arrays/.test(i.title)));
  assert.equal(dash.body.closingSoon.length, 3);
  assert.ok(dash.body.closingSoon[0].daysLeft <= dash.body.closingSoon[2].daysLeft);
  assert.ok(dash.body.leaderboard.some((r) => r.isYou));
  assert.ok(user.id);
});

test('streak maths', () => {
  const t = '2026-10-10';
  assert.deepEqual(stats.streaksFromDays([], t), { current: 0, longest: 0 });
  assert.deepEqual(stats.streaksFromDays(['2026-10-09', '2026-10-10'], t), { current: 2, longest: 2 });
  assert.equal(stats.streaksFromDays(['2026-10-08', '2026-10-09'], t).current, 2, 'yesterday still counts');
  assert.equal(stats.streaksFromDays(['2026-10-07', '2026-10-09'], t).current, 1, 'gap breaks it');
  assert.equal(stats.streaksFromDays(['2026-09-01', '2026-09-02', '2026-09-03', '2026-10-10'], t).longest, 3);
});

/* ---------------------------------------------------------- leaderboard / content */
test('leaderboard ranks by points and supports scopes', async () => {
  const a = client(); const b = client();
  const ua = await signup(a, 'Lead Alpha', 'alpha@college.edu', { branch: 'MECH', year: '2nd Year' });
  const ub = await signup(b, 'Lead Beta', 'beta@college.edu', { branch: 'MECH', year: '2nd Year' });
  const hard = db.prepare("SELECT id FROM questions WHERE difficulty = 'Hard' AND category = 'DSA'").get();
  const easy = db.prepare("SELECT id FROM questions WHERE difficulty = 'Easy' AND category = 'DSA'").get();
  await a.post(`/api/questions/${hard.id}/attempt`, { solved: true }); // +40
  await b.post(`/api/questions/${easy.id}/attempt`, { solved: true }); // +10

  const mech = await a.get('/api/leaderboard?scope=branch');
  assert.equal(mech.body.total, 2);
  assert.deepEqual(mech.body.entries.map((e) => e.name), ['Lead Alpha', 'Lead Beta']);
  assert.equal(mech.body.you.rank, 1);
  assert.equal(mech.body.you.points, 40);
  assert.equal((await b.get('/api/leaderboard?scope=year')).body.you.rank, 2);

  const overall = await a.get('/api/leaderboard');
  assert.ok(overall.body.total >= 2);
  assert.equal(overall.body.entries.some((e) => e.role), false);
  assert.ok(ua.id && ub.id);
});

test('opportunities: open only, filters, daysLeft', async () => {
  const c = client();
  await signup(c, 'Opp Viewer', 'opp@college.edu');
  db.prepare("INSERT INTO opportunities (title, company, type, location, link, deadline) VALUES ('Old One','Acme','job','Delhi','https://x.test',?)").run(addDays(today(), -2));
  db.prepare("INSERT INTO opportunities (title, company, type, location, link, deadline) VALUES ('Today One','Acme','job','Delhi','https://x.test',?)").run(today());

  const all = await c.get('/api/opportunities');
  assert.equal(all.body.opportunities.some((o) => o.title === 'Old One'), false, 'expired hidden');
  const t = all.body.opportunities.find((o) => o.title === 'Today One');
  assert.equal(t.daysLeft, 0);
  assert.equal(all.body.opportunities[0].title, 'Today One', 'soonest first');
  assert.ok((await c.get('/api/opportunities?type=internship')).body.opportunities.every((o) => o.type === 'internship'));
  assert.ok((await c.get('/api/opportunities?q=google')).body.count >= 1);
});

test('alumni experiences: create, helpful toggle, permissions', async () => {
  const a = client(); const b = client();
  await signup(a, 'Story Teller', 'teller@college.edu');
  await signup(b, 'Other Student', 'other@college.edu');

  assert.equal((await a.post('/api/experiences', { company: '', role: 'SDE', name: 'X', tip: 'y' })).status, 400);
  const made = await a.post('/api/experiences', { company: 'Zoho', role: 'Developer', name: 'Story Teller', year: 2026, status: 'Offer', rounds: ['Aptitude', 'Coding', 'HR'], tip: 'Practice pointers.' });
  assert.equal(made.status, 201);
  const id = made.body.experience.id;
  assert.equal(made.body.experience.full, 'Practice pointers.');
  assert.equal(made.body.experience.canDelete, true);

  const first = (await b.get('/api/experiences')).body.experiences[0];
  assert.equal(first.id, id, 'newest first');
  assert.equal(first.canDelete, false);

  assert.deepEqual((await b.post(`/api/experiences/${id}/helpful`)).body, { helpful: true, helpfulCount: 1 });
  assert.deepEqual((await b.post(`/api/experiences/${id}/helpful`)).body, { helpful: false, helpfulCount: 0 });
  assert.equal((await b.get('/api/experiences?q=zoho')).body.count, 1);

  assert.equal((await b.del(`/api/experiences/${id}`)).status, 403);
  assert.equal((await a.del(`/api/experiences/${id}`)).status, 200);
  assert.equal((await a.del(`/api/experiences/${id}`)).status, 404);
});

test('admin endpoints are admin-only and validate input', async () => {
  const student = client();
  await signup(student, 'Plain Student', 'plain@college.edu');
  assert.equal((await student.post('/api/admin/opportunities', {})).status, 403);

  const admin = client();
  assert.equal((await admin.post('/api/auth/login', { email: 'admin@college.edu', password: 'Admin@12345' })).status, 200);

  const bad = await admin.post('/api/admin/opportunities', { title: 'Evil', company: 'X', type: 'job', location: 'Y', link: 'javascript:alert(1)', deadline: addDays(today(), 5) });
  assert.equal(bad.status, 400, 'non-http links are rejected');

  const made = await admin.post('/api/admin/opportunities', { title: 'New Grad', company: 'Zomato', type: 'job', location: 'Gurugram', pay: '₹20 LPA', link: 'https://zomato.com/careers', deadline: addDays(today(), 9) });
  assert.equal(made.status, 201);
  assert.ok((await student.get('/api/opportunities?q=zomato')).body.count === 1);
  assert.equal((await admin.del(`/api/admin/opportunities/${made.body.id}`)).status, 200);
  assert.equal((await student.get('/api/opportunities?q=zomato')).body.count, 0);

  const q = await admin.post('/api/admin/questions', { title: 'Reverse Linked List', category: 'DSA', topic: 'Linked Lists', difficulty: 'Easy', timeMinutes: 15, companies: ['Amazon'], description: 'Reverse a singly linked list.' });
  assert.equal(q.status, 201);
  assert.equal((await admin.post('/api/admin/questions', { title: 'MCQ bad', category: 'Aptitude', topic: 'T', difficulty: 'Easy', timeMinutes: 2, options: ['a', 'b'], answer: 'c' })).status, 400);
  assert.ok((await student.get('/api/questions?q=linked')).body.count === 1);
});

test('security: passwords hashed, cookie is httpOnly, XSS payloads are stored as plain data', async () => {
  const c = client();
  await signup(c, 'Sec Tester', 'sec@college.edu');
  const row = db.prepare("SELECT password_hash FROM users WHERE email = 'sec@college.edu'").get();
  assert.match(row.password_hash, /^\$2[aby]\$/);

  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'sec@college.edu', password: 'Secret123' }) });
  const cookie = res.headers.getSetCookie().join(';');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);

  const x = await c.post('/api/experiences', { company: '<img src=x onerror=alert(1)>', role: 'r', name: 'n', tip: 't' });
  assert.equal(x.status, 201);
  assert.equal(x.body.experience.company, '<img src=x onerror=alert(1)>'); // escaped by the frontend when rendered
});
