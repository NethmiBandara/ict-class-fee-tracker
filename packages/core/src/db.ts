import {
  createClient,
  type Client,
  type InArgs,
  type Row,
} from "@libsql/client/web";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const ENV_KEYS = [
  "SUPABASE_DATABASE_URL",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "SQLITE_DATA_DIR",
  "VERCEL",
  "VERCEL_ENV",
] as const;

function searchRoots(): string[] {
  const roots = [process.cwd()];
  try {
    roots.push(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    // Bundlers may not expose import.meta.url.
  }
  return roots;
}

function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function loadLocalEnvFiles() {
  if (globalThis.__feeEnvLoaded) return;
  globalThis.__feeEnvLoaded = true;

  const candidates: string[] = [];
  for (const start of searchRoots()) {
    let dir = start;
    for (let i = 0; i < 10; i++) {
      candidates.push(
        path.join(dir, ".env"),
        path.join(dir, ".env.local"),
        path.join(dir, "apps", "web", ".env"),
        path.join(dir, "apps", "web", ".env.local"),
        path.join(dir, "apps", "api", ".env"),
        path.join(dir, "apps", "api", ".env.local"),
      );
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  const seen = new Set<string>();
  for (const file of candidates) {
    const resolved = path.resolve(file);
    if (seen.has(resolved) || !fs.existsSync(resolved)) continue;
    seen.add(resolved);
    let parsed: Record<string, string>;
    try {
      parsed = parseEnvFile(fs.readFileSync(resolved, "utf8"));
    } catch {
      continue;
    }
    for (const key of ENV_KEYS) {
      if (process.env[key] === undefined && parsed[key]) {
        process.env[key] = parsed[key];
      }
    }
  }
}

function resolveRepoRoot(): string | null {
  for (const start of searchRoots()) {
    let dir = start;
    for (let i = 0; i < 10; i++) {
      if (
        fs.existsSync(path.join(dir, "apps", "api")) &&
        fs.existsSync(path.join(dir, "apps", "web"))
      ) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

function resolveDataDir(): string {
  loadLocalEnvFiles();
  if (process.env.SQLITE_DATA_DIR) {
    return path.resolve(process.env.SQLITE_DATA_DIR);
  }

  const repoRoot = resolveRepoRoot();
  if (repoRoot) return path.join(repoRoot, "apps", "api", "data");

  const fallbacks = [
    path.join(process.cwd(), "apps", "api", "data"),
    path.join(process.cwd(), "..", "api", "data"),
  ];
  for (const dir of fallbacks) {
    if (fs.existsSync(path.join(dir, "fees.db"))) return dir;
  }
  return fallbacks[0];
}

function getDbPath() {
  return path.join(resolveDataDir(), "fees.db");
}

declare global {
  var __feeLocalDb: DatabaseSync | undefined;
  var __feeLocalDbPath: string | undefined;
  var __feeRemoteDb: Client | undefined;
  var __feePg: postgres.Sql | undefined;
  var __feeSchemaReady: boolean | undefined;
  var __feeSchemaPromise: Promise<void> | undefined;
  var __feeEnvLoaded: boolean | undefined;
}

export type BillingPeriod = "monthly" | "weekly" | "daily";

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigError";
  }
}

function isRemoteUrl(url: string | undefined): url is string {
  return Boolean(
    url &&
      (url.startsWith("libsql://") ||
        url.startsWith("https://") ||
        url.startsWith("http://")),
  );
}

function isVercel() {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}

function isPostgresUrl(url: string | undefined): url is string {
  return Boolean(url && /^postgres(ql)?:\/\//i.test(url));
}

type Engine = "postgres" | "libsql" | "local";

function getEngine(): Engine {
  loadLocalEnvFiles();
  const supabaseUrl = process.env.SUPABASE_DATABASE_URL?.trim();
  if (supabaseUrl) {
    if (!isPostgresUrl(supabaseUrl)) {
      throw new DatabaseConfigError(
        "SUPABASE_DATABASE_URL must be a Postgres connection string from Supabase.",
      );
    }
    return "postgres";
  }
  if (isRemoteUrl(process.env.TURSO_DATABASE_URL)) return "libsql";
  if (isVercel()) {
    throw new DatabaseConfigError(
      "Local SQLite cannot run on Vercel. Set SUPABASE_DATABASE_URL to the Supabase Postgres connection string.",
    );
  }
  return "local";
}

export function getDatabaseMode(): "remote" | "local" {
  return getEngine() === "local" ? "local" : "remote";
}

function getLocalDb(): DatabaseSync {
  const dbPath = getDbPath();
  if (!globalThis.__feeLocalDb || globalThis.__feeLocalDbPath !== dbPath) {
    if (globalThis.__feeLocalDb) {
      try {
        globalThis.__feeLocalDb.close();
      } catch {
        // Replace a stale connection opened against a different file.
      }
    }
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    globalThis.__feeLocalDb = new DatabaseSync(dbPath);
    globalThis.__feeLocalDbPath = dbPath;
    globalThis.__feeSchemaReady = false;
  }
  return globalThis.__feeLocalDb;
}

function persistLocalWrites() {
  try {
    getLocalDb().exec("PRAGMA wal_checkpoint(FULL);");
  } catch {
    // Another reader may hold the WAL; the write is still durable.
  }
}

function getRemoteDb(): Client {
  loadLocalEnvFiles();
  if (!globalThis.__feeRemoteDb) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!isRemoteUrl(url)) {
      throw new DatabaseConfigError(
        "TURSO_DATABASE_URL is missing or invalid.",
      );
    }
    globalThis.__feeRemoteDb = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return globalThis.__feeRemoteDb;
}

function getPostgres(): postgres.Sql {
  loadLocalEnvFiles();
  if (!globalThis.__feePg) {
    const url = process.env.SUPABASE_DATABASE_URL?.trim();
    if (!isPostgresUrl(url)) {
      throw new DatabaseConfigError(
        "SUPABASE_DATABASE_URL is missing or invalid.",
      );
    }
    globalThis.__feePg = postgres(url, {
      prepare: false,
      fetch_types: false,
      ssl: "require",
      // Supabase's transaction pooler (port 6543) stalls if two queries are
      // sent on one connection before the first answer comes back. Keep one
      // query per connection and let the rest wait.
      max: 10,
      max_pipeline: 1,
      idle_timeout: 20,
      connect_timeout: 15,
      query_timeout: 20,
    });
  }
  return globalThis.__feePg;
}

function argList(args: InArgs): Array<string | number | boolean | null | Date | Buffer> {
  const values = (Array.isArray(args) ? args : []) as Array<
    string | number | bigint | boolean | null | Date | Buffer | undefined
  >;
  return values.map((value) => {
    if (value === undefined) return null;
    if (typeof value === "bigint") return Number(value);
    return value;
  });
}

function toPostgresSql(sql: string): string {
  let out = "";
  let index = 0;
  let param = 0;
  while (index < sql.length) {
    const char = sql[index];
    if (char === "'") {
      const start = index;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'") {
          if (sql[index + 1] === "'") {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      out += sql.slice(start, index);
      continue;
    }
    if (char === "?") {
      param += 1;
      out += `$${param}`;
      index += 1;
      continue;
    }
    out += char;
    index += 1;
  }
  return out.replace(/([\w.]+)\s+COLLATE\s+NOCASE/gi, "lower($1)");
}

function withReturningId(sql: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (!/^insert\b/i.test(trimmed) || /\breturning\b/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed} RETURNING id`;
}

const POSTGRES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    monthly_fee INTEGER NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),
    billing_period TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly', 'weekly', 'daily')),
    created_at TEXT NOT NULL DEFAULT (to_char(timezone('Asia/Colombo', clock_timestamp()), 'YYYY-MM-DD HH24:MI:SS'))
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (to_char(timezone('Asia/Colombo', clock_timestamp()), 'YYYY-MM-DD HH24:MI:SS'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    student_name TEXT NOT NULL DEFAULT '',
    year INTEGER NOT NULL CHECK (year >= 2000),
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    week INTEGER NOT NULL DEFAULT 0 CHECK (week BETWEEN 0 AND 53),
    slot INTEGER NOT NULL DEFAULT 0 CHECK (slot >= 0),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    paid_on TEXT NOT NULL DEFAULT (to_char(timezone('Asia/Colombo', clock_timestamp()), 'YYYY-MM-DD')),
    note TEXT,
    UNIQUE (student_id, year, month, week, slot)
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    year INTEGER NOT NULL CHECK (year >= 2000),
    week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 53),
    attended INTEGER NOT NULL DEFAULT 1 CHECK (attended IN (0, 1)),
    attended_on TEXT NOT NULL,
    UNIQUE (student_id, attended_on)
  );

  CREATE TABLE IF NOT EXISTS class_holidays (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    year INTEGER NOT NULL CHECK (year >= 2000),
    week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 53),
    holiday_on TEXT,
    note TEXT,
    UNIQUE (class_id, holiday_on)
  );

  CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
  CREATE INDEX IF NOT EXISTS idx_payments_period ON payments(year, month, week);
  CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_week ON attendance(year, week);
  CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_day ON attendance(attended_on);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_class_holidays_legacy_week
    ON class_holidays(class_id, year, week) WHERE holiday_on IS NULL;
  CREATE INDEX IF NOT EXISTS idx_class_holidays_week ON class_holidays(class_id, year, week);
  CREATE INDEX IF NOT EXISTS idx_class_holidays_day ON class_holidays(class_id, holiday_on);
`;

async function migratePostgres() {
  if (globalThis.__feeSchemaReady) return;
  if (!globalThis.__feeSchemaPromise) {
    globalThis.__feeSchemaPromise = (async () => {
      const db = getPostgres();
      const statements = POSTGRES_SCHEMA.split(";")
        .map((statement) => statement.trim())
        .filter(Boolean);
      for (const statement of statements) {
        await db.unsafe(statement);
      }
      globalThis.__feeSchemaReady = true;
    })().catch((error) => {
      globalThis.__feeSchemaPromise = undefined;
      throw error;
    });
  }
  await globalThis.__feeSchemaPromise;
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  return value;
}

function normalizeRow<T>(row: Record<string, unknown> | Row): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    out[key] = normalizeValue((row as Record<string, unknown>)[key]);
  }
  return out as T;
}

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    monthly_fee INTEGER NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),
    billing_period TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly', 'weekly', 'daily')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    student_name TEXT NOT NULL DEFAULT '',
    year INTEGER NOT NULL CHECK (year >= 2000),
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    week INTEGER NOT NULL DEFAULT 0 CHECK (week BETWEEN 0 AND 53),
    slot INTEGER NOT NULL DEFAULT 0 CHECK (slot >= 0),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    paid_on TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    note TEXT,
    UNIQUE (student_id, year, month, week, slot)
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    year INTEGER NOT NULL CHECK (year >= 2000),
    week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 53),
    attended INTEGER NOT NULL DEFAULT 1 CHECK (attended IN (0, 1)),
    attended_on TEXT NOT NULL,
    UNIQUE (student_id, year, week)
  );

  CREATE TABLE IF NOT EXISTS class_holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    year INTEGER NOT NULL CHECK (year >= 2000),
    week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 53),
    note TEXT,
    UNIQUE (class_id, year, week)
  );

  CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
  CREATE INDEX IF NOT EXISTS idx_payments_period ON payments(year, month, week);
  CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_week ON attendance(year, week);
  CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
  CREATE INDEX IF NOT EXISTS idx_class_holidays_week ON class_holidays(class_id, year, week);
`;

async function tableColumns(
  mode: "remote" | "local",
  table: string,
): Promise<string[]> {
  if (mode === "local") {
    const cols = getLocalDb()
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    return cols.map((c) => c.name);
  }
  const info = await getRemoteDb().execute(`PRAGMA table_info(${table})`);
  return info.rows.map((row) => String(row.name));
}

async function execSql(mode: "remote" | "local", sql: string) {
  if (mode === "local") {
    getLocalDb().exec(sql);
    return;
  }
  await getRemoteDb().execute(sql);
}

async function tableExists(
  mode: "remote" | "local",
  table: string,
): Promise<boolean> {
  if (mode === "local") {
    const row = getLocalDb()
      .prepare(
        `SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = ?`,
      )
      .get(table) as { n?: number } | undefined;
    return Boolean(row);
  }
  const result = await getRemoteDb().execute({
    sql: `SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = ?`,
    args: [table],
  });
  return result.rows.length > 0;
}

async function rawCount(
  mode: "remote" | "local",
  table: string,
): Promise<number> {
  if (!(await tableExists(mode, table))) return 0;
  if (mode === "local") {
    const row = getLocalDb()
      .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
      .get() as { n: number };
    return Number(row.n || 0);
  }
  const result = await getRemoteDb().execute(
    `SELECT COUNT(*) AS n FROM ${table}`,
  );
  return Number(result.rows[0]?.n || 0);
}

async function snapshotCoreCounts(mode: "remote" | "local") {
  return {
    classes: await rawCount(mode, "classes"),
    students: await rawCount(mode, "students"),
    payments: await rawCount(mode, "payments"),
    attendance: await rawCount(mode, "attendance"),
    holidays: await rawCount(mode, "class_holidays"),
  };
}

function assertCountsPreserved(
  before: Record<string, number>,
  after: Record<string, number>,
) {
  for (const [table, count] of Object.entries(before)) {
    const next = after[table] ?? 0;
    if (next < count) {
      throw new DatabaseConfigError(
        `Refusing to finish migration: ${table} went from ${count} to ${next} rows.`,
      );
    }
  }
}

async function recoverPaymentsStaging(
  mode: "remote" | "local",
  staging: string,
) {
  const hasPayments = await tableExists(mode, "payments");
  const hasStaging = await tableExists(mode, staging);
  if (!hasPayments && hasStaging) {
    await execSql(mode, `ALTER TABLE ${staging} RENAME TO payments`);
    return;
  }
  if (hasPayments && hasStaging) {
    await execSql(mode, `DROP TABLE ${staging}`);
  }
}

async function rebuildPaymentsTable(
  mode: "remote" | "local",
  staging: string,
  createSql: string,
  copySql: string,
) {
  await recoverPaymentsStaging(mode, staging);
  const before = await rawCount(mode, "payments");
  await execSql(mode, createSql);
  await execSql(mode, copySql);
  const copied = await rawCount(mode, staging);
  if (copied !== before) {
    await execSql(mode, `DROP TABLE ${staging}`);
    throw new DatabaseConfigError(
      `Payment migration refused: copied ${copied} of ${before} rows. Existing payments were left unchanged.`,
    );
  }

  const finalize = [
    `DROP TABLE payments`,
    `ALTER TABLE ${staging} RENAME TO payments`,
    `CREATE INDEX IF NOT EXISTS idx_payments_period ON payments(year, month, week)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id)`,
  ];

  if (mode === "local") {
    const db = getLocalDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const sql of finalize) db.exec(sql);
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Keep the original error.
      }
      throw error;
    }
    return;
  }

  await getRemoteDb().batch(
    finalize.map((sql) => ({ sql })),
    "write",
  );
}

async function tableCreateSql(
  mode: "remote" | "local",
  table: string,
): Promise<string> {
  if (mode === "local") {
    const row = getLocalDb()
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
      )
      .get(table) as { sql?: string } | undefined;
    return row?.sql ?? "";
  }
  const result = await getRemoteDb().execute({
    sql: `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
    args: [table],
  });
  return String(result.rows[0]?.sql ?? "");
}

async function recoverStagingTable(
  mode: "remote" | "local",
  source: string,
  staging: string,
) {
  const hasSource = await tableExists(mode, source);
  const hasStaging = await tableExists(mode, staging);
  if (!hasSource && hasStaging) {
    await execSql(mode, `ALTER TABLE ${staging} RENAME TO ${source}`);
    return;
  }
  if (hasSource && hasStaging) {
    await execSql(mode, `DROP TABLE ${staging}`);
  }
}

async function replaceTable(
  mode: "remote" | "local",
  source: string,
  staging: string,
  createSql: string,
  copySql: string,
  finalizeSql: string[],
) {
  await recoverStagingTable(mode, source, staging);
  const before = await rawCount(mode, source);
  await execSql(mode, createSql);
  await execSql(mode, copySql);
  const copied = await rawCount(mode, staging);
  if (copied !== before) {
    await execSql(mode, `DROP TABLE ${staging}`);
    throw new DatabaseConfigError(
      `${source} migration refused: copied ${copied} of ${before} rows. Existing rows were left unchanged.`,
    );
  }

  const finalize = [
    `DROP TABLE ${source}`,
    `ALTER TABLE ${staging} RENAME TO ${source}`,
    ...finalizeSql,
  ];

  if (mode === "local") {
    const db = getLocalDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const sql of finalize) db.exec(sql);
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Keep the original error.
      }
      throw error;
    }
    return;
  }

  await getRemoteDb().batch(
    finalize.map((sql) => ({ sql })),
    "write",
  );
}

async function ensureDayAttendance(mode: "remote" | "local") {
  if (!(await tableExists(mode, "attendance"))) return;
  const createSql = await tableCreateSql(mode, "attendance");
  if (/UNIQUE\s*\(\s*student_id\s*,\s*attended_on\s*\)/i.test(createSql)) {
    await execSql(
      mode,
      `CREATE INDEX IF NOT EXISTS idx_attendance_day ON attendance(attended_on)`,
    );
    return;
  }

  const total = await rawCount(mode, "attendance");
  const distinctSql = `SELECT COUNT(*) AS n FROM (SELECT student_id, attended_on FROM attendance GROUP BY student_id, attended_on)`;
  const distinct =
    mode === "local"
      ? Number(
          (getLocalDb().prepare(distinctSql).get() as { n: number }).n || 0,
        )
      : Number((await getRemoteDb().execute(distinctSql)).rows[0]?.n || 0);
  if (distinct !== total) {
    throw new DatabaseConfigError(
      `Attendance migration refused: ${total - distinct} rows share a student and class date. Existing attendance was left unchanged.`,
    );
  }

  await replaceTable(
    mode,
    "attendance",
    "attendance_v2",
    `
    CREATE TABLE attendance_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      year INTEGER NOT NULL CHECK (year >= 2000),
      week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 53),
      attended INTEGER NOT NULL DEFAULT 1 CHECK (attended IN (0, 1)),
      attended_on TEXT NOT NULL,
      UNIQUE (student_id, attended_on)
    )
    `,
    `
    INSERT INTO attendance_v2 (id, student_id, year, week, attended, attended_on)
    SELECT id, student_id, year, week, attended, attended_on
    FROM attendance
    `,
    [
      `CREATE INDEX IF NOT EXISTS idx_attendance_week ON attendance(year, week)`,
      `CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id)`,
      `CREATE INDEX IF NOT EXISTS idx_attendance_day ON attendance(attended_on)`,
    ],
  );
}

async function ensureDayHolidays(mode: "remote" | "local") {
  if (!(await tableExists(mode, "class_holidays"))) return;
  const cols = await tableColumns(mode, "class_holidays");
  if (!cols.includes("holiday_on")) {
    await replaceTable(
      mode,
      "class_holidays",
      "class_holidays_v2",
      `
      CREATE TABLE class_holidays_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        year INTEGER NOT NULL CHECK (year >= 2000),
        week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 53),
        holiday_on TEXT,
        note TEXT,
        UNIQUE (class_id, holiday_on)
      )
      `,
      `
      INSERT INTO class_holidays_v2 (id, class_id, year, week, holiday_on, note)
      SELECT id, class_id, year, week, NULL, note
      FROM class_holidays
      `,
      [],
    );
  }

  await execSql(
    mode,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_class_holidays_legacy_week
     ON class_holidays(class_id, year, week) WHERE holiday_on IS NULL`,
  );
  await execSql(
    mode,
    `CREATE INDEX IF NOT EXISTS idx_class_holidays_week ON class_holidays(class_id, year, week)`,
  );
  await execSql(
    mode,
    `CREATE INDEX IF NOT EXISTS idx_class_holidays_day ON class_holidays(class_id, holiday_on)`,
  );
}

async function ensureDailyBillingPeriod(mode: "remote" | "local") {
  if (!(await tableExists(mode, "classes"))) return;
  const createSql = await tableCreateSql(mode, "classes");
  if (createSql.includes("'daily'")) return;

  await recoverStagingTable(mode, "classes", "classes_v2");
  const before = await rawCount(mode, "classes");
  const createNew = `
    CREATE TABLE classes_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      monthly_fee INTEGER NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),
      billing_period TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly', 'weekly', 'daily')),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `;
  const copy = `
    INSERT INTO classes_v2 (id, name, monthly_fee, billing_period, created_at)
    SELECT id, name, monthly_fee,
      CASE
        WHEN billing_period IN ('monthly', 'weekly', 'daily') THEN billing_period
        ELSE 'monthly'
      END,
      created_at
    FROM classes
  `;

  if (mode === "local") {
    const db = getLocalDb();
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      db.exec(createNew);
      db.exec(copy);
      const copied = Number(
        (db.prepare(`SELECT COUNT(*) AS n FROM classes_v2`).get() as { n: number })
          .n || 0,
      );
      if (copied !== before) {
        db.exec("DROP TABLE classes_v2");
        throw new DatabaseConfigError(
          `Class migration refused: copied ${copied} of ${before} rows. Existing classes were left unchanged.`,
        );
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec("DROP TABLE classes");
        db.exec("ALTER TABLE classes_v2 RENAME TO classes");
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // Keep the original error.
        }
        throw error;
      }
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
    return;
  }

  const remote = getRemoteDb();
  const dependents = ["students", "payments", "attendance", "class_holidays"] as const;
  const beforeDependents = new Map<string, number>();
  try {
    for (const table of dependents) {
      const count = await rawCount(mode, table);
      beforeDependents.set(table, count);
      await execSql(mode, `DROP TABLE IF EXISTS ${table}_keep`);
      if (!(await tableExists(mode, table))) continue;
      await execSql(mode, `CREATE TABLE ${table}_keep AS SELECT * FROM ${table}`);
      const backedUp = await rawCount(mode, `${table}_keep`);
      if (backedUp !== count) {
        throw new DatabaseConfigError(
          `${table} migration refused: backed up ${backedUp} of ${count} rows. Existing rows were left unchanged.`,
        );
      }
    }

    await remote.execute(createNew);
    await remote.execute(copy);
    const copied = await rawCount(mode, "classes_v2");
    if (copied !== before) {
      await execSql(mode, "DROP TABLE classes_v2");
      throw new DatabaseConfigError(
        `Class migration refused: copied ${copied} of ${before} rows. Existing classes were left unchanged.`,
      );
    }

    // Libsql runs each request on its own connection, so a separate
    // PRAGMA foreign_keys=OFF does not apply to the drop. Dropping classes
    // then deletes students, payments, and attendance through ON DELETE CASCADE.
    // Copy those tables first and put them back in the same script as the drop.
    const statements = [
      "PRAGMA foreign_keys = OFF",
      "DROP TABLE classes",
      "ALTER TABLE classes_v2 RENAME TO classes",
    ];
    for (const table of dependents) {
      if (!(await tableExists(mode, `${table}_keep`))) continue;
      statements.push(`DELETE FROM ${table}`);
      statements.push(`INSERT INTO ${table} SELECT * FROM ${table}_keep`);
      statements.push(`DROP TABLE ${table}_keep`);
    }
    statements.push("PRAGMA foreign_keys = ON");
    await remote.executeMultiple(statements.join(";\n"));

    for (const [table, count] of beforeDependents) {
      const now = await rawCount(mode, table);
      if (now < count) {
        throw new DatabaseConfigError(
          `${table} migration refused: ${count} rows became ${now}.`,
        );
      }
    }
  } catch (error) {
    for (const table of dependents) {
      const keep = `${table}_keep`;
      if (!(await tableExists(mode, keep))) continue;
      const expected = beforeDependents.get(table) ?? 0;
      const now = await rawCount(mode, table);
      if (now < expected) {
        try {
          await remote.executeMultiple(
            `PRAGMA foreign_keys = OFF;\nINSERT INTO ${table} SELECT * FROM ${keep};\nDROP TABLE ${keep};`,
          );
        } catch {
          // Leave the backup table in place for recovery.
        }
      } else {
        await execSql(mode, `DROP TABLE ${keep}`);
      }
    }
    if (await tableExists(mode, "classes_v2")) {
      const classesLeft = await rawCount(mode, "classes");
      if (classesLeft > 0) await execSql(mode, "DROP TABLE classes_v2");
    }
    throw error;
  }
}

async function ensureSchemaUpgrades(mode: "remote" | "local") {
  const before = await snapshotCoreCounts(mode);
  await recoverPaymentsStaging(mode, "payments_v2");
  await recoverPaymentsStaging(mode, "payments_v3");

  const classCols = await tableColumns(mode, "classes");
  if (!classCols.includes("billing_period")) {
    await execSql(
      mode,
      `ALTER TABLE classes ADD COLUMN billing_period TEXT NOT NULL DEFAULT 'monthly'`,
    );
  }

  const paymentCols = await tableColumns(mode, "payments");
  if (!paymentCols.includes("student_name")) {
    await execSql(
      mode,
      `ALTER TABLE payments ADD COLUMN student_name TEXT NOT NULL DEFAULT ''`,
    );
    await execSql(
      mode,
      `UPDATE payments
       SET student_name = COALESCE(
         (SELECT name FROM students WHERE students.id = payments.student_id),
         ''
       )
       WHERE student_name = '' OR student_name IS NULL`,
    );
  }

  if (!paymentCols.includes("week")) {
    await rebuildPaymentsTable(
      mode,
      "payments_v2",
      `
      CREATE TABLE IF NOT EXISTS payments_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        student_name TEXT NOT NULL DEFAULT '',
        year INTEGER NOT NULL CHECK (year >= 2000),
        month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
        week INTEGER NOT NULL DEFAULT 0 CHECK (week BETWEEN 0 AND 53),
        amount INTEGER NOT NULL CHECK (amount >= 0),
        paid_on TEXT NOT NULL DEFAULT (date('now', 'localtime')),
        note TEXT,
        UNIQUE (student_id, year, month, week)
      )
      `,
      `
      INSERT INTO payments_v2 (id, student_id, student_name, year, month, week, amount, paid_on, note)
      SELECT id, student_id, COALESCE(student_name, ''), year, month, 0, amount, paid_on, note
      FROM payments
      `,
    );
  }

  const paymentColsAfter = await tableColumns(mode, "payments");
  if (!paymentColsAfter.includes("slot")) {
    await rebuildPaymentsTable(
      mode,
      "payments_v3",
      `
      CREATE TABLE IF NOT EXISTS payments_v3 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        student_name TEXT NOT NULL DEFAULT '',
        year INTEGER NOT NULL CHECK (year >= 2000),
        month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
        week INTEGER NOT NULL DEFAULT 0 CHECK (week BETWEEN 0 AND 53),
        slot INTEGER NOT NULL DEFAULT 0 CHECK (slot >= 0),
        amount INTEGER NOT NULL CHECK (amount >= 0),
        paid_on TEXT NOT NULL DEFAULT (date('now', 'localtime')),
        note TEXT,
        UNIQUE (student_id, year, month, week, slot)
      )
      `,
      `
      INSERT INTO payments_v3 (id, student_id, student_name, year, month, week, slot, amount, paid_on, note)
      SELECT id, student_id, COALESCE(student_name, ''), year, month, week, 0, amount, paid_on, note
      FROM payments
      `,
    );
  }

  await execSql(
    mode,
    `CREATE TABLE IF NOT EXISTS class_holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      year INTEGER NOT NULL CHECK (year >= 2000),
      week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 53),
      note TEXT,
      UNIQUE (class_id, year, week)
    )`,
  );
  await execSql(
    mode,
    `CREATE INDEX IF NOT EXISTS idx_class_holidays_week ON class_holidays(class_id, year, week)`,
  );

  await ensureDayHolidays(mode);
  await ensureDayAttendance(mode);
  await ensureDailyBillingPeriod(mode);

  assertCountsPreserved(before, await snapshotCoreCounts(mode));
}

async function migrate() {
  if (getEngine() === "postgres") {
    await migratePostgres();
    return;
  }
  const mode = getDatabaseMode();
  if (globalThis.__feeSchemaReady) {
    await execSql(
      mode,
      `CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        year INTEGER NOT NULL CHECK (year >= 2000),
        week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 53),
        attended INTEGER NOT NULL DEFAULT 1 CHECK (attended IN (0, 1)),
        attended_on TEXT NOT NULL,
        UNIQUE (student_id, attended_on)
      )`,
    );
    await execSql(
      mode,
      `CREATE TABLE IF NOT EXISTS class_holidays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        year INTEGER NOT NULL CHECK (year >= 2000),
        week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 53),
        holiday_on TEXT,
        note TEXT,
        UNIQUE (class_id, holiday_on)
      )`,
    );
    await ensureDayHolidays(mode);
    await ensureDayAttendance(mode);
    await ensureDailyBillingPeriod(mode);
    return;
  }

  if (mode === "local") {
    const db = getLocalDb();
    db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;",
    );
    db.exec(MIGRATION_SQL);
    persistLocalWrites();
  } else {
    const client = getRemoteDb();
    const statements = MIGRATION_SQL.split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((sql) => ({ sql }));
    await client.batch(statements, "write");
  }

  await ensureSchemaUpgrades(mode);
  if (mode === "local") persistLocalWrites();
  globalThis.__feeSchemaReady = true;
}

export async function sqlAll<T>(sql: string, args: InArgs = []): Promise<T[]> {
  await migrate();
  if (getEngine() === "postgres") {
    const result = await getPostgres().unsafe(toPostgresSql(sql), argList(args));
    return result.map((row) => normalizeRow<T>(row as Record<string, unknown>));
  }
  if (getDatabaseMode() === "local") {
    const stmt = getLocalDb().prepare(sql);
    const values = (Array.isArray(args) ? args : []) as Array<
      string | number | bigint | null | Buffer
    >;
    return stmt
      .all(...values)
      .map((row) => normalizeRow<T>(row as Record<string, unknown>));
  }

  const result = await getRemoteDb().execute({ sql, args });
  return result.rows.map((row) => normalizeRow<T>(row));
}

export async function sqlGet<T>(
  sql: string,
  args: InArgs = [],
): Promise<T | undefined> {
  const rows = await sqlAll<T>(sql, args);
  return rows[0];
}

export async function sqlRun(
  sql: string,
  args: InArgs = [],
): Promise<{ lastInsertRowid: number; changes: number }> {
  await migrate();
  if (getEngine() === "postgres") {
    const result = await getPostgres().unsafe(
      toPostgresSql(withReturningId(sql)),
      argList(args),
    );
    const inserted = result[0] as { id?: number | bigint | string } | undefined;
    return {
      lastInsertRowid: inserted?.id == null ? 0 : Number(inserted.id),
      changes: Number(result.count ?? 0),
    };
  }
  if (getDatabaseMode() === "local") {
    const stmt = getLocalDb().prepare(sql);
    const values = (Array.isArray(args) ? args : []) as Array<
      string | number | bigint | null | Buffer
    >;
    const result = stmt.run(...values);
    persistLocalWrites();
    return {
      lastInsertRowid: Number(result.lastInsertRowid),
      changes: Number(result.changes),
    };
  }

  const result = await getRemoteDb().execute({ sql, args });
  return {
    lastInsertRowid: Number(result.lastInsertRowid),
    changes: Number(result.rowsAffected),
  };
}

export type StorageInfo = {
  mode: "local" | "remote";
  engine: "sqlite" | "turso" | "supabase";
  path?: string;
  counts: {
    classes: number;
    students: number;
    payments: number;
    attendance: number;
    holidays: number;
  };
};

async function countRows(table: string): Promise<number> {
  const row = await sqlGet<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(row?.n || 0);
}

export async function getStorageInfo(): Promise<StorageInfo> {
  const engine = getEngine();
  const mode = engine === "local" ? "local" : "remote";
  return {
    mode,
    engine:
      engine === "postgres" ? "supabase" : engine === "libsql" ? "turso" : "sqlite",
    path: mode === "local" ? getDbPath() : undefined,
    counts: {
      classes: await countRows("classes"),
      students: await countRows("students"),
      payments: await countRows("payments"),
      attendance: await countRows("attendance"),
      holidays: await countRows("class_holidays"),
    },
  };
}

export type ClassRow = {
  id: number;
  name: string;
  monthly_fee: number;
  billing_period: BillingPeriod;
  created_at: string;
};

export type StudentRow = {
  id: number;
  class_id: number;
  name: string;
  phone: string | null;
  active: number;
  created_at: string;
};

export type PaymentRow = {
  id: number;
  student_id: number;
  student_name: string;
  year: number;
  month: number;
  week: number;
  slot: number;
  amount: number;
  paid_on: string;
  note: string | null;
};

export type AttendanceRow = {
  id: number;
  student_id: number;
  year: number;
  week: number;
  attended: number;
  attended_on: string;
};

export type ClassHolidayRow = {
  id: number;
  class_id: number;
  year: number;
  week: number;
  holiday_on: string | null;
  note: string | null;
};
