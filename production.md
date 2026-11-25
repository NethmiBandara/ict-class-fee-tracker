# ICT Class Fee Tracker — production notes

Tracks ICT class fees in **LKR**. Teachers record attendance by class day, holidays, and payments. Monthly classes bill every 4 present days. Weekly classes bill one week at a time. Daily classes keep each attended day, and one payment can cover several of those days.

Live site: [https://ict-class-fee-tracker.vercel.app](https://ict-class-fee-tracker.vercel.app)

## How it is built

npm workspaces monorepo. Node.js **22+** is required (`node:sqlite` locally, `.nvmrc`).

| Path | Role |
| --- | --- |
| `apps/web` | Next.js UI. **This is what Vercel hosts.** Server components and server actions talk to the database through `@ict/core`. |
| `apps/api` | Optional Express API on port **4000**. Not used in production. |
| `packages/core` | Shared database layer (local SQLite, production Supabase Postgres), schema, queries, billing, mutations. |

Production does not need a separate API host. The Next.js server writes to **Supabase Postgres** directly.

## Environments

| | Localhost | Production |
| --- | --- | --- |
| App | `http://localhost:3000` | `https://ict-class-fee-tracker.vercel.app` |
| Database | SQLite `apps/api/data/fees.db` | Supabase Postgres (`SUPABASE_DATABASE_URL`) |
| Optional API | `http://localhost:4000` | not deployed |

These are separate databases. A deploy changes app code only. It never copies localhost rows into Supabase. Do not run `scripts/copy-sqlite-to-supabase.mjs` against the live school database.

## Environment variables

Set these on the **Vercel web project** (Production, Preview, Development as needed):

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_DATABASE_URL` | **Yes on Vercel** | Postgres connection string from Supabase → Connect → Transaction pooler (port 6543). Encode `@` in the password as `%40`. |
| `SQLITE_DATA_DIR` | No | Override local SQLite folder (defaults to `apps/api/data`) |
| `PORT` | No | Express API port (default `4000`) |
| `WEB_ORIGIN` | No | CORS origin for the Express API (default `http://localhost:3000`) |

If `SUPABASE_DATABASE_URL` is missing on Vercel, the app cannot use local SQLite and `/api/health` returns an error. Local development needs no env file.

## App pages (production)

All pages read/write through `@ict/core` (server actions), not the Express API.

| Path | What it does |
| --- | --- |
| `/` | Dashboard: monthly income, paid/unpaid, recent payments |
| `/classes` | Create/list/delete classes |
| `/classes/[id]` | Attendance by date, holidays, payments |
| `/records` | Filter students by month, paid/unpaid, class |
| `/reports` | Annual income plus class-wise / student-wise attendance |
| `/api/health` | Storage mode and row counts (see below) |

## Billing rules

- Monthly classes: each present class day counts. **4 present days = 1 fee month.** Absences and holidays are skipped.
- Weekly classes: one payment per ISO week.
- Daily classes: attendance is stored per calendar date. One payment can cover several attended days.
- Amounts are integers in LKR.

## Database

Tables are created/upgraded on first request. Upgrades copy existing payment rows and **abort if a row count would shrink**.

| Table | Purpose |
| --- | --- |
| `classes` | Name, fee, `billing_period` (`monthly` \| `weekly` \| `daily`) |
| `students` | Name, phone, active flag, class |
| `payments` | Unique on `(student_id, year, month, week, slot)` |
| `attendance` | Unique on `(student_id, attended_on)` |
| `class_holidays` | A row with `holiday_on` is one day. A null `holiday_on` is a legacy whole-week holiday. |

Deleting a class or student cascades to related rows.

## Production HTTP API

The only public HTTP route on Vercel is health.

### `GET /api/health`

Confirms the live app can reach Supabase. After deploy, `mode` must be `"remote"`, `engine` must be `"supabase"`, and counts must not drop.

```json
{
  "ok": true,
  "mode": "remote",
  "engine": "supabase",
  "counts": {
    "classes": 10,
    "students": 37,
    "payments": 29,
    "attendance": 151,
    "holidays": 1
  }
}
```

On localhost, `mode` is `"local"`, `engine` is `"sqlite"`, and `path` is the SQLite file. A `500` means `SUPABASE_DATABASE_URL` is missing or unreachable.

Writes on production go through **Next.js server actions** in `apps/web/src/lib/actions.ts` (same mutations as the Express API).

## Optional Express API (local / self-host only)

Base URL: `http://localhost:4000`. JSON in/out. CORS allows `WEB_ORIGIN`. Mutation responses: `{ "ok": true, "id"?: number }` or `{ "ok": false, "error": "…" }` (`400` / `404`).

### Meta

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/` | Service hint; not the web UI |
| `GET` | `/api/health` | Same shape as the Next.js health route |

### Classes

| Method | Path | Body / query |
| --- | --- | --- |
| `GET` | `/api/classes` | — |
| `GET` | `/api/classes/:id` | — |
| `POST` | `/api/classes` | `name`, `monthly_fee`, `billing_period` (`monthly` \| `weekly` \| `daily`), `students` (string or array of names) |
| `PATCH` | `/api/classes/:id` | `name`, `monthly_fee`, `billing_period` |
| `DELETE` | `/api/classes/:id` | — |
| `GET` | `/api/classes/:id/holiday` | Query: `year`, `week` |
| `GET` | `/api/classes/:id/students` | Query: `year`, `month`, optional `week` |
| `POST` | `/api/classes/:id/students` | `name` (one or many), optional `phone` |

### Students

| Method | Path | Body |
| --- | --- | --- |
| `PATCH` | `/api/students/:id` | `name`, `phone`, `active` (`1` / `0`) |
| `DELETE` | `/api/students/:id` | — |
| `GET` | `/api/students/:id/billing` | Fee slots for the student (paid / unpaid / leftover / upcoming weeks) |

### Attendance and holidays

| Method | Path | Body |
| --- | --- | --- |
| `PUT` | `/api/attendance` | `student_id`, `year`, `week`, `attended` (`1`/`0` or boolean), optional `attended_on` (`YYYY-MM-DD`) |
| `PUT` | `/api/attendance/bulk` | `class_id`, `attended_on`, `student_ids` (array) |
| `PUT` | `/api/holidays` | `class_id`, `year`, `week`, `holiday` (`1`/`0` or boolean), optional `note` |

### Payments

| Method | Path | Body / query |
| --- | --- | --- |
| `POST` | `/api/payments` | `student_id`, `year`, `month`, optional `week`, `slot`, `periods` `[{ year, month, slot, week }]`, `amount`, `note`, `paid_on` (`YYYY-MM-DD`) |
| `DELETE` | `/api/payments` | Same period fields as POST (no amount) |
| `GET` | `/api/payments/recent` | Query: optional `limit` (default `8`) |

### Records and stats

| Method | Path | Query |
| --- | --- | --- |
| `GET` | `/api/records` | **Required:** `year`, `month`. Optional: `week`, `classId`, `status` (`all` \| `paid` \| `unpaid`), `billingPeriod` (`monthly` \| `weekly` \| `daily`) |
| `GET` | `/api/stats/monthly` | `year`, `month` |
| `GET` | `/api/stats/monthly/classes` | `year`, `month` |
| `GET` | `/api/stats/annual` | `year` |
| `GET` | `/api/stats/annual/months` | `year` |
| `GET` | `/api/stats/annual/classes` | `year` |
| `GET` | `/api/stats/annual/attendance` | `year` |

## Automation

A Cursor agent named **QA and merge to master** is Active for this repository. It is stored in Cursor, not in git.

| | |
| --- | --- |
| Trigger | A pull request is pushed in `NethmiBandara/ict-class-fee-tracker` |
| Test data | Local SQLite only. The live Supabase database is not used. |
| Checks | Dashboard, class list, one class page, records, reports, and `/api/health` on the local database |
| Result | Comment on the pull request. Merge into `master` only if every check passed. |
| Deploy | The agent does not deploy. Vercel deploys `master` after the merge. |

## Deploy on Vercel

Repo-root `vercel.json` already sets:

- install: `npm install`
- build: `npm run build -w web`
- output: `apps/web/.next`
- framework: Next.js

Checklist:

1. Supabase project at [supabase.com](https://supabase.com)
2. `SUPABASE_DATABASE_URL` on the Vercel web project (transaction pooler, port 6543; encode `@` in the password as `%40`)
3. Node **22** on the Vercel project
4. If build fails looking for `.next`, turn **off** Output Directory Override, or set it to `apps/web/.next`
5. Redeploy **code only**
6. Hit `https://ict-class-fee-tracker.vercel.app/api/health` — expect `"mode": "remote"`, `"engine": "supabase"`, and counts that have not dropped

## Local commands

```bash
npm install
npm run dev:web          # web only, http://localhost:3000
npm run dev              # web + Express API
npx tsx scripts/verify-storage.mjs
```

## Do not

- Point production at SQLite
- Copy `apps/api/data/fees.db` into Supabase
- Run `scripts/copy-sqlite-to-supabase.mjs` against the live school database
- Commit `.env` files or the SQLite database
- Host the Express app on Vercel — the Next.js app is the production backend
- Let the QA agent connect to the live Supabase database
