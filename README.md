# Yaxha Academics

**Build mastery. One day at a time.**

A personal study app for engineering students. It imports your Google Classroom classes as subjects, keeps every lesson file in a searchable library, turns your real course materials into reviewers, quizzes and flashcards, tutors you step by step, and plans your days around your exams.

Everything shown as progress comes from what you actually did in the app. Nothing is estimated, and readiness is never presented as a grade prediction.

---

## What's inside

| Area | What it does |
|---|---|
| **Home** | Today's plan (realistic, fits your daily target), what to study next with the reason, upcoming exams, new Classroom items, quick study-time logging. |
| **My Subjects** | One subject per class. Rename freely; the original Classroom name and id are kept and can be restored. Tabs: Overview, All Materials, Assignments, Summaries, Quizzes, Flashcards, Progress. |
| **Materials Library** | Search, filter (type, topic, source), sort, list/grid, pagination, "new" and "updated" markers. In-app PDF viewer (pages, zoom, fullscreen, download), images, video, links, Google files open in Google. Upload PDF, Word, PowerPoint, images or text, or write notes. |
| **Study packs** | Summaries in 7 modes, quizzes (multiple choice, true/false, short answer, numerical, formula, multi-step), flashcards with spaced repetition. All built from the extracted text of the materials you pick, with page citations and a note when only part of a long source was used. |
| **Grading** | Objective and numerical answers are graded by code, not AI: units are converted, tolerance applied, near misses flagged for your review. Numerical answer keys are re-computed from their formula to catch wrong keys. Mistake analysis and partial credit for written answers use AI and are labelled as such. |
| **AI Study Room** | Teach Me, Solve With Me, Test Me, Fix My Mistakes. Attach a photo of a problem. Sessions are saved. |
| **Exam Planner** | Add an exam, its topics, difficulty and confidence; get a day-by-day plan (learn, practise, review, mock exam) that respects your study days and rebuilds when you miss sessions. Readiness is computed from coverage, accuracy, recency and repeated mistakes. |
| **Google Classroom** | Read-only import of courses, topics, coursework, materials, announcements and your submission status; Drive attachments downloaded (Docs and Slides exported to PDF) so their text can be studied. Honest connection states; restricted files are marked, never bypassed. |
| **Progress** | Study time, sessions, planned tasks done, quiz scores over time, accuracy by subject, weakest topics, recurring mistakes, coverage. Each chart has a table view. |
| **Settings** | Profile, password, study rhythm (Asia/Manila by default), reminders preference, AI status, Google connection, data export (JSON), account deletion. |

## How it is built

- **Next.js 16** (App Router, server components, server actions) with **TypeScript** and **Tailwind CSS 4**.
- **PostgreSQL** (plain Postgres or Supabase). Every user-data table has **Row Level Security**; the app runs each request as a restricted role scoped to the signed-in user, so one user can never read another's rows even if app code has a bug.
- Own email/password auth (scrypt hashes, http-only session cookies, login rate limiting).
- Google OAuth 2.0 with PKCE; tokens encrypted with AES-256-GCM before they are stored.
- AI through one server-side provider module (Anthropic by default via the official SDK, or any OpenAI-compatible API), with per-user hourly limits, usage logging, and duplicate-request reuse.
- Files are stored in the database; text is extracted on upload (PDF via pdf.js, Word via mammoth, PowerPoint slides directly).

No secret ever reaches the browser: AI keys, the Google client secret, tokens and the database URL are read only on the server.

---

## Run it on your computer

You need **Node.js 20.9 or newer** and **PostgreSQL 15 or newer** (or a free Supabase project, see below).

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
#    then edit .env: set DATABASE_URL, APP_URL=http://localhost:3000,
#    and TOKEN_ENCRYPTION_KEY (the file explains how to generate it)

# 3. Create the tables
npm run db:migrate

# 4. Start
npm run dev
```

Open http://localhost:3000, create your account, and follow the two onboarding steps.

**Local PostgreSQL in one command** (if you have Docker):

```bash
docker run -d --name yaxha-db -p 5432:5432 -e POSTGRES_USER=yaxha -e POSTGRES_PASSWORD=yaxha -e POSTGRES_DB=yaxha postgres:16
```

Without Google or AI keys the app still works: subjects, uploads, the library and PDF viewer, notes, exams and plans, flashcards you write, progress, and settings. Pages that need a key say so plainly.

### Turn on AI

1. Create an API key at https://console.anthropic.com (or use another provider, see below).
2. In `.env` set `AI_API_KEY=...`. Leave `AI_MODEL` empty to use `claude-opus-5-5`, or set `claude-sonnet-5-5` / `claude-haiku-5-5` to spend less.
3. Restart the app.

For an OpenAI-compatible provider set `AI_PROVIDER=openai`, `AI_API_KEY`, `AI_MODEL`, and (if not OpenAI itself) `AI_BASE_URL`.

### Turn on Google Classroom

Follow **[docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md)** (about 15 minutes, free). In short: create a Google Cloud project, enable the Classroom and Drive APIs, configure the consent screen in Testing mode with yourself as a test user, create a Web OAuth client with the redirect URI `{APP_URL}/api/google/callback`, and put the client id and secret in `.env`.

---

## Put it online

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for a click-by-click guide using **Supabase** (database) and **Vercel** (hosting), both with free tiers.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server on http://localhost:3000 |
| `npm run build` then `npm start` | Production build and server |
| `npm run db:migrate` | Apply new database migrations (safe to run any time) |
| `npm test` | Unit, integration and security tests (needs a test database, see below) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run check` | Typecheck, lint and tests together |
| `npm run test:e2e` | Browser walk-through of a production build with desktop, tablet and iPhone screenshots in `screenshots/` (needs Playwright: `npm i -D playwright && npx playwright install chromium`) |

### Tests

The tests run against a real PostgreSQL database named `yaxha_test` (see `vitest.config.mts`):

```bash
createdb yaxha_test
DATABASE_URL=postgres://yaxha:yaxha@localhost:5432/yaxha_test npm run db:migrate
npm test
```

They cover grading and unit conversion, the planner, spaced repetition and recommendations, file validation and text extraction, row-level security isolation between users, Google Classroom sync against a fake Google API (no duplicates, renamed courses, removed items, restricted files, missing Drive permission, expired or revoked sign-in), and AI generation against a fake AI provider (real source text in prompts, invalid output never saved, duplicate reuse). Fakes prove the app's own logic; they are not evidence that a real Google account or AI key works.

## Costs

| Piece | Cost |
|---|---|
| Hosting (Vercel Hobby) | Free for personal, non-commercial use |
| Database (Supabase Free) | Free up to 500 MB. Uploaded files are stored in the database, so a few hundred lesson PDFs fit; heavy use may need the paid plan |
| Google Classroom / Drive APIs | Free |
| AI | Pay per use. Claude Opus 5.5 is $4 per million input tokens and $20 per million output tokens; Sonnet 5.5 is $2 / $10; Haiku 5.5 is $0.10 / $0.50 (check current prices at anthropic.com/pricing). A detailed reviewer of a 20-page lesson is roughly 15,000 tokens in and 3,000 to 6,000 out, so very roughly $0.10 to $0.20 on Opus, half that on Sonnet, and under a cent on Haiku. Model reasoning is billed as output, so real costs vary. `AI_MAX_REQUESTS_PER_HOUR` caps spending per user. |

## Known limitations

- **Scanned PDFs**: there is no OCR. Image-only PDFs are flagged as "no readable text"; you can still view them and ask the AI tutor about a photo of a page.
- **Reminders** are saved as a preference and shown in the app; no emails or push notifications are sent.
- **Classroom sync** runs when you press Sync Now on the Google Classroom page. It is not automatic or real-time.
- **Upload size on Vercel** is limited to about 4.5 MB per file by the platform; larger files work when self-hosted (`MAX_UPLOAD_MB`).
- **Drive access** uses the `drive.readonly` scope, which Google treats as restricted: personal use in Testing mode works; publishing the app to the public would need Google's verification.
- **Tutor chats** do not change topic mastery; quizzes and flashcard reviews do.

## Security notes

- Sessions: random 256-bit tokens, stored hashed; cookies are http-only, `SameSite=Lax`, and `Secure` in production.
- Passwords: scrypt with per-user salt. Failed sign-ins are rate limited per email.
- Database: Row Level Security on every user table; the public Supabase API roles have no access.
- Google: authorization code flow with PKCE and a one-time state; tokens are AES-256-GCM encrypted; disconnecting revokes them at Google and deletes them.
- Uploads: type checked by content (magic bytes), not just extension; size limited.
- Set `ALLOW_SIGNUP=false` once your own account exists if the app is on the internet.

## Project layout

```
src/app/(app)/        signed-in pages (home, subjects, materials, exams, study, classroom, progress, settings)
src/app/actions/      server actions (all writes)
src/app/api/          upload, file download, Google OAuth, export
src/lib/              database, auth, crypto, files, AI, Google, study logic (grading, planner, SRS, readiness)
src/components/       UI components
db/migrations/        SQL schema with RLS policies
tests/                Vitest tests and fixtures
scripts/              migrations runner and browser walk-through
```
