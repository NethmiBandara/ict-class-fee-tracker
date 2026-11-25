# ICT Class Fee Tracker

Simple responsive app to track ICT class student fees in **LKR**.

This is an npm workspaces monorepo:

- `apps/web` — Next.js UI (also runs the data layer on the server)
- `apps/api` — optional Express API
- `packages/core` — local SQLite or production Supabase, queries, and mutations

## Features

- Monthly classes: 4 present class days = 1 fee month
- Weekly classes: one payment per week
- Daily classes: attendance per day, and one payment can cover several attended days
- Dashboard, records, and annual reports

## Run locally

Needs Node.js 22 or newer (`node:sqlite`).

```bash
npm install
npm run dev:web
```

Open [http://localhost:3000](http://localhost:3000). Local SQLite is always `apps/api/data/fees.db` — both the Next.js app and the optional API write to that file. Check `http://localhost:3000/api/health` to confirm the mode and row counts.

The Express API is optional:

```bash
npm run dev
```

- Web: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:4000](http://localhost:4000)

## Deploy on Vercel

Vercel hosts `apps/web`. The Next.js server talks to Supabase directly. You do not need a separate API host.

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. In Vercel → Project → Settings → Environment Variables, set `SUPABASE_DATABASE_URL` to the Postgres connection string from Supabase → Connect → Transaction pooler (port 6543). If the database password contains `@`, write it as `%40` inside the URL.
3. Keep the repo-root `vercel.json` (build `npm run build -w web`, output `apps/web/.next`).
4. Redeploy the code only. Existing classes, students, payments, attendance, and holidays stay in Supabase.
5. Open `/api/health` on the deployed site. It should report `"mode": "remote"` and `"engine": "supabase"`. Class, student, payment, attendance, and holiday counts must not drop.

If a deploy says `.next` was not found, turn off Output Directory Override in Vercel, or set it to `apps/web/.next`.

Use Node.js 22 on Vercel (see `.nvmrc`). Tables are created automatically on first request.

Localhost (`apps/api/data/fees.db`) and production (Supabase) are separate databases. A production deploy never copies localhost rows into Supabase. Do not run `scripts/copy-sqlite-to-supabase.mjs` against the live school database.

## Automation

Pull requests are tested by a Cursor agent named **QA and merge to master**. The agent is saved in Cursor and is turned on. It is not a file in this repository.

- It starts when a pull request is pushed in `NethmiBandara/ict-class-fee-tracker`.
- It checks out that pull request and tests the app on local SQLite only. It does not connect to the live Supabase database and does not change school data.
- It opens the dashboard, the class list, one class page, records, and reports, and checks that `/api/health` is using the local database.
- It comments on the pull request with what passed and what failed.
- It merges into `master` only when every check passed.
- It does not deploy. Vercel deploys `master` after that merge.
