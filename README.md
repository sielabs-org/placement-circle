# Placement Circle

A student placement-prep platform: daily practice missions, a question library, streaks and points,
progress charts, leaderboard, internships/jobs, and alumni interview experiences.

```
frontend/   static HTML/CSS/JS pages (served by the backend)
backend/    Node.js + Express + SQLite REST API
```

## Quick start

Requires **Node.js 22.5 or newer** (tested on 22 and works on 24). SQLite is built into Node, so
there is nothing else to install: no Visual Studio, no Python, no database server.

```bash
cd backend
npm install
npm start            # http://localhost:3000
```

Open **http://localhost:3000** (not the HTML files directly: the pages need the API and the login cookie).

First run seeds 14 questions, 8 internships/jobs and 4 alumni stories. Optional extras:

```bash
node src/seed.js --demo     # fake students so the leaderboard isn't empty
                            # demo login: student@college.edu / Student@2026  (dev only!)
npm test                    # 14 API tests
```

## Signup
Signup is a single step: fill in the form and the account is created and logged in immediately
(there is no OTP / email verification). Use `ALLOWED_EMAIL_DOMAINS=college.edu` in `backend/.env`
to restrict signups to your college email addresses.

## Configuration (`backend/.env`)
| Variable | Purpose |
|---|---|
| `JWT_SECRET` | **Required in production** (32+ random chars: `openssl rand -hex 32`) |
| `APP_TIMEZONE` | Day boundary for streaks/daily mission (default `Asia/Kolkata`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Creates an admin on startup (for `/api/admin/*`) |
| `DB_PATH`, `PORT`, `CORS_ORIGIN`, `TRUST_PROXY` | Deployment options (see `.env.example`) |

## API overview (all under `/api`, cookie auth)
- **Auth:** `POST /auth/signup`, `/auth/login`, `/auth/logout`, `GET /auth/me`
- **Practice:** `GET /questions`, `GET /questions/:id`, `POST /questions/:id/attempt`, `GET /daily`
- **Me:** `GET /dashboard`, `GET /progress`, `GET|PUT /profile`
- **Community:** `GET /leaderboard?scope=overall|branch|year`, `GET /opportunities`, `GET|POST /experiences`, `POST /experiences/:id/helpful`, `DELETE /experiences/:id`
- **Admin:** `/admin/*` to manage questions and opportunities

## Known limitations
- DSA and HR questions are self-graded (honour system); only aptitude MCQs are auto-graded.
- Notification bell, forgot-password and light mode on most pages are not implemented yet.
- `frontend/js/script.js` is leftover demo code (not used by any page) and can be deleted.
