# ICT Class Fee Tracker — production notes

Tracks ICT class fees in **LKR**. Teachers record weekly attendance, holiday weeks, and payments. **Four present weeks = one fee month.** Absent weeks and holiday weeks do not count toward that month. Students can pay early; later present weeks fill that paid month.

Live site: [https://ict-class-fee-tracker.vercel.app](https://ict-class-fee-tracker.vercel.app)

## How it is built

npm workspaces monorepo. Node.js **22+** is required (`node:sqlite` locally, `.nvmrc`).

| Path | Role |
| --- | --- |
| `apps/web` | Next.js UI. **This is what Vercel hosts.** Server components and server actions talk to the database through `@ict/core`. |
| `apps/api` | Optional Express API on port **4000**. Not used in production. |
| `packages/core` | Shared SQLite/Turso layer, schema, queries, billing, mutations. |

Production does **not** need `API_URL` or a separate API host. The Next.js server writes to **Turso** directly.

## Environments

| | Localhost | Production |
| --- | --- | --- |
| App | `http://localhost:3000` | `https://ict-class-fee-tracker.vercel.app` |
| Database | SQLite `apps/api/data/fees.db` | Turso (`TURSO_DATABASE_URL`) |
| Optional API | `http://localhost:4000` | not deployed |

These are **separate databases**. A deploy changes app code only. It never copies localhost rows onto Turso. Do not run `scripts/push-local-to-turso.mjs` against the live school database.

## Environment variables

Set these on the **Vercel web project** (Production, Preview, Development as needed):

| Variable | Required | Purpose |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | **Yes on Vercel** | `libsql://…` database URL |
| `TURSO_AUTH_TOKEN` | **Yes on Vercel** | Turso auth token |
| `SQLITE_DATA_DIR` | No | Override local SQLite folder (defaults to `apps/api/data`) |
| `PORT` | No | Express API port (default `4000`) |
| `WEB_ORIGIN` | No | CORS origin for the Express API (default `http://localhost:3000`) |
| `API_URL` | No | Unused in production. Local web `.env.local` may still have it. |

If Turso is missing on Vercel, the app cannot use local SQLite (ephemeral filesystem) and `/api/health` returns an error.

## App pages (production)

All pages read/write through `@ict/core` (server actions), not the Express API.

| Path | What it does |
| --- | --- |
| `/` | Dashboard: monthly income, paid/unpaid, recent payments |
| `/classes` | Create/list/delete classes |
| `/classes/[id]` | Attendance by date, holiday weeks, payments (including pay early) |
| `/records` | Filter students by month, paid/unpaid, class |
| `/reports` | Annual income plus class-wise / student-wise attendance |
| `/api/health` | Storage mode and row counts (see below) |

## Billing rules

- ISO week attendance. One present day in a week counts as that week present.
- **4 present weeks = 1 paying month** for monthly classes.
- Holiday weeks and absences are skipped.
- Late pay fills unpaid complete months first.
- Pay-early marks an incomplete leftover slot; later present weeks attach to that paid month until 4 weeks are filled.
- Weekly-billed classes pay per ISO week instead of a 4-week slot.
- Amounts are integers in LKR.

## Database

Tables are created/upgraded on first request. Upgrades copy existing payment rows and **abort if a row count would shrink**.

| Table | Purpose |
| --- | --- |
| `classes` | Name, fee, `billing_period` (`monthly` \| `weekly`) |
| `students` | Name, phone, active flag, class |
| `payments` | Unique on `(student_id, year, month, week, slot)` |
| `attendance` | Unique on `(student_id, year, week)` plus `attended_on` |
| `class_holidays` | Unique on `(class_id, year, week)` |

Deleting a class or student cascades to related rows.

## Production HTTP API

The only public HTTP route on Vercel is health.

### `GET /api/health`

Confirms the live app can reach Turso. After deploy, `mode` must be `"remote"` and counts must not drop.

```json
{
  "ok": true,
  "mode": "remote",
  "counts": {
    "classes": 9,
    "students": 32,
    "payments": 0,
    "attendance": 0,
    "holidays": 0
  }
}
```

On localhost, `mode` is `"local"` and `path` is the SQLite file. `500` with an error means Turso is missing or unreachable.

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
| `POST` | `/api/classes` | `name`, `monthly_fee`, `billing_period` (`monthly` \| `weekly`), `students` (string or array of names) |
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
| `GET` | `/api/records` | **Required:** `year`, `month`. Optional: `week`, `classId`, `status` (`all` \| `paid` \| `unpaid`), `billingPeriod` (`monthly` \| `weekly`) |
| `GET` | `/api/stats/monthly` | `year`, `month` |
| `GET` | `/api/stats/monthly/classes` | `year`, `month` |
| `GET` | `/api/stats/annual` | `year` |
| `GET` | `/api/stats/annual/months` | `year` |
| `GET` | `/api/stats/annual/classes` | `year` |
| `GET` | `/api/stats/annual/attendance` | `year` |

## Deploy on Vercel

Repo-root `vercel.json` already sets:

- install: `npm install`
- build: `npm run build -w web`
- output: `apps/web/.next`
- framework: Next.js

Checklist:

1. Turso database at [turso.tech](https://turso.tech)
2. `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` on the Vercel **web** project
3. Node **22** on the Vercel project
4. If build fails looking for `.next`, turn **off** Output Directory Override, or set it to `apps/web/.next`
5. Redeploy **code only**
6. Hit `https://ict-class-fee-tracker.vercel.app/api/health` — expect `"mode": "remote"` and the same class/student counts as before

## Local commands

```bash
npm install
npm run dev:web          # web only, http://localhost:3000
npm run dev              # web + Express API
npx tsx scripts/verify-storage.mjs
```

## Do not

- Point production at SQLite
- Copy `apps/api/data/fees.db` into Turso
- Commit `.env*` files or the SQLite database
- Host the Express app on Vercel — the Next.js app is the production backend
