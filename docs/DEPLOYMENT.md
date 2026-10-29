# Put Yaxha online (Supabase + Vercel, free tiers)

This guide assumes no prior deployment experience. It takes about 30 minutes. You will end up with a private URL like `https://yaxha-yourname.vercel.app` that works on your laptop, tablet and phone.

What you need: a GitHub account, the project in a GitHub repository, and an email for Supabase and Vercel.

## 1. Database on Supabase

1. Sign up at https://supabase.com > **New project**. Pick a name, a strong database password (save it), and the region closest to you (for the Philippines, **Southeast Asia (Singapore)**).
2. When it is ready: **Connect** (top bar) > **Transaction pooler**. Copy the URI. It looks like
   `postgres://postgres.abcd:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`
   Replace `[YOUR-PASSWORD]` with your password. This is your `DATABASE_URL`.
3. Nothing else to do here: on Vercel, every deploy runs `npm run vercel-build`, which creates or updates the tables before building (the build log shows `Applied 001_initial_schema.sql` the first time). To create them from your own computer instead, run `DATABASE_URL="postgres://...:6543/postgres" npm run db:migrate`.

Supabase's own public API cannot read Yaxha's tables: the migration turns on Row Level Security and gives the `anon` and `authenticated` roles no access. Yaxha talks to the database only from its server.

## 2. Hosting on Vercel

1. Sign up at https://vercel.com with GitHub > **Add New > Project** > import your repository.
2. Framework preset: **Next.js** (detected automatically). Leave build settings as they are.
3. **Environment Variables**: add
   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the Supabase transaction pooler URI |
   | `APP_URL` | optional on Vercel (the production domain is used when unset); set it if you add a custom domain |
   | `TOKEN_ENCRYPTION_KEY` | needed for Google Classroom; 64 hex characters: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `AI_API_KEY` | optional, your AI key |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional, from [GOOGLE_SETUP.md](GOOGLE_SETUP.md) |
   | `MAX_UPLOAD_MB` | `4` (Vercel accepts request bodies up to about 4.5 MB) |
4. **Deploy**. When it finishes, open the URL and create your account.
5. Once your account exists, add `ALLOW_SIGNUP=false` and redeploy so nobody else can sign up.

## 3. Google redirect for the online address

In Google Cloud > Credentials > your OAuth client, add the redirect URI
`https://<project-name>.vercel.app/api/google/callback` and save. Then connect Classroom from the online app.

## 4. Use it on your phone

Open the URL in Safari (iPhone) or Chrome (Android) and choose **Share > Add to Home Screen**. It opens full screen like an app.

## Updating

Push changes to GitHub; Vercel redeploys automatically. New files in `db/migrations` are applied by the deploy's build step.

## Backups

- **Your data**: Settings > **Export all my data (JSON)** downloads a JSON file of your subjects, materials list, study packs, quizzes, flashcards, exams and progress.
- **Whole database**: `pg_dump "$DATABASE_URL" > yaxha-backup.sql` (use the **Session pooler** or direct connection URI for pg_dump). Supabase's free plan does not include automatic backups you can restore yourself.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Application error" on every page | Check `DATABASE_URL` in Vercel and that migrations ran. Vercel > Deployments > Logs shows the exact error. |
| Sign-in works locally but not online | `APP_URL` must be the https Vercel address. |
| Upload fails online for big files | Vercel's 4.5 MB request limit. Compress the PDF or host elsewhere. |
| Google "redirect_uri_mismatch" | Step 3: the online redirect URI is missing or has a typo. |
| AI says "not configured" | `AI_API_KEY` missing; redeploy after adding it. |
| Supabase project paused | Free projects pause after a period of inactivity; open the Supabase dashboard and restore it. |

## Other hosts

Any host that runs Node.js 20.9+ works: `npm ci && npm run build && npm start` with the same environment variables. On a VPS or Railway/Render there is no 4.5 MB upload limit.
