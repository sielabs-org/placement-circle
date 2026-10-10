# Changes in this update

## 1. OTP removed (signup is now one step)
- backend/src/routes/auth.js  -> removed request-otp / verify / resend-otp, added POST /api/auth/signup
- backend/src/config.js, server.js, db.js -> removed OTP / SMTP / pending_signups
- backend/src/services/mailer.js -> DELETED
- backend/package.json (+lock) -> nodemailer removed (run `npm install` in backend/)
- backend/.env.example, README.md, backend/test/api.test.js -> updated (14/14 tests pass)
- frontend/pages/signup.html, js/signup.js, css/signup.css, css/animations.css -> single "Create account" form

## 2. UI made more user friendly
- All frontend/css/*.css: font sizes raised (minimum now 13px, body text +2-3px), dim text colours lightened
- login.css / signup.css: bigger inputs (50px), bigger buttons (52px), wider form (430px)
- progress.css: bigger prep-score ring; profile.css: wider stat tiles + bigger activity grid

## Run
cd backend && npm install && npm start   ->  open http://localhost:3000
