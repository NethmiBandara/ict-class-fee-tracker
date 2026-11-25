import { cookies } from "next/headers";
import { deleteAuthSession, getUserForSession, type AuthUser } from "@ict/core";
import {
  readSessionToken,
  safeNextPath,
  SESSION_COOKIE,
  signSessionToken,
} from "@/lib/session-token";

const MAX_AGE = 60 * 60 * 24 * 14;

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const jar = await cookies();
  const payload = readSessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  return getUserForSession(payload.sid);
}

export async function writeSessionCookie(sessionId: string, expiresAt: number) {
  const token = signSessionToken({ sid: sessionId, exp: expiresAt });
  if (!token) {
    throw new Error("AUTH_SECRET is missing.");
  }
  const maxAge = Math.min(
    MAX_AGE,
    Math.max(60, expiresAt - Math.floor(Date.now() / 1000)),
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOptions(maxAge));
}

export async function destroySession() {
  const jar = await cookies();
  const payload = readSessionToken(jar.get(SESSION_COOKIE)?.value);
  if (payload) {
    try {
      await deleteAuthSession(payload.sid);
    } catch {
      // Clear the cookie even if the database is briefly unavailable.
    }
  }
  jar.set(SESSION_COOKIE, "", cookieOptions(0));
}

export { safeNextPath };
