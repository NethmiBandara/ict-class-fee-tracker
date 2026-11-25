import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { sqlGet, sqlRun } from "./db";

const scryptAsync = promisify(scrypt);
const SESSION_SECONDS = 60 * 60 * 24 * 14;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AuthUser = {
  id: number;
  name: string;
  email: string;
};

type UserRecord = AuthUser & { password_hash: string };

let dummyPasswordHash: string | null = null;

function isUniqueError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique|duplicate/i.test(message);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

async function burnPasswordCheck(password: string) {
  if (!dummyPasswordHash) {
    dummyPasswordHash = await hashPassword("not-a-real-password");
  }
  await verifyPassword(password, dummyPasswordHash);
}

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  const name = input.name.trim().replace(/\s+/g, " ");
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (name.length < 2) {
    return { ok: false, error: "Name must be at least 2 characters." };
  }
  if (name.length > 80) {
    return { ok: false, error: "Name is too long." };
  }
  if (!EMAIL_RE.test(email) || email.length > 160) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (password.length > 200) {
    return { ok: false, error: "Password is too long." };
  }

  const passwordHash = await hashPassword(password);
  try {
    const result = await sqlRun(
      "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
      [name, email, passwordHash],
    );
    return {
      ok: true,
      user: { id: Number(result.lastInsertRowid), name, email },
    };
  } catch (error) {
    if (isUniqueError(error)) {
      return { ok: false, error: "An account with that email already exists." };
    }
    throw error;
  }
}

export async function authenticateUser(
  email: string,
  password: string,
): Promise<AuthUser | null> {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized) || password.length < 1 || password.length > 200) {
    await burnPasswordCheck(password || " ");
    return null;
  }

  const row = await sqlGet<UserRecord>(
    "SELECT id, name, email, password_hash FROM users WHERE email = ?",
    [normalized],
  );
  if (!row) {
    await burnPasswordCheck(password);
    return null;
  }
  const matches = await verifyPassword(password, row.password_hash);
  if (!matches) return null;
  return { id: Number(row.id), name: row.name, email: row.email };
}

export async function createAuthSession(
  userId: number,
): Promise<{ id: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  await sqlRun("DELETE FROM sessions WHERE expires_at <= ?", [now]);
  const id = randomBytes(32).toString("hex");
  const expiresAt = now + SESSION_SECONDS;
  await sqlRun(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
    [id, userId, expiresAt],
  );
  return { id, expiresAt };
}

export async function getUserForSession(
  sessionId: string,
): Promise<AuthUser | null> {
  if (!/^[a-f0-9]{64}$/.test(sessionId)) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = await sqlGet<AuthUser>(
    `SELECT u.id AS id, u.name AS name, u.email AS email
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
    [sessionId, now],
  );
  if (!row) return null;
  return { id: Number(row.id), name: row.name, email: row.email };
}

export async function deleteAuthSession(sessionId: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(sessionId)) return;
  await sqlRun("DELETE FROM sessions WHERE id = ?", [sessionId]);
}
