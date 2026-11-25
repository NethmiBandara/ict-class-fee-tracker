import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "ict_session";

export type SessionPayload = {
  sid: string;
  exp: number;
};

const DEV_SECRET = "dev-only-ict-fee-tracker-session-key-32";

function secret(): string | null {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1") {
    return null;
  }
  return DEV_SECRET;
}

function sign(body: string, key: string) {
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function canSignSessions() {
  return secret() !== null;
}

export function signSessionToken(payload: SessionPayload): string | null {
  const key = secret();
  if (!key) return null;
  const body = Buffer.from(
    JSON.stringify({ sid: payload.sid, exp: payload.exp }),
  ).toString("base64url");
  return `${body}.${sign(body, key)}`;
}

export function readSessionToken(
  token: string | undefined | null,
): SessionPayload | null {
  const key = secret();
  if (!key || !token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(body, key);
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (
    actualBuf.length !== expectedBuf.length ||
    !timingSafeEqual(actualBuf, expectedBuf)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as Partial<SessionPayload>;
    if (typeof parsed.sid !== "string" || typeof parsed.exp !== "number") {
      return null;
    }
    if (!Number.isFinite(parsed.exp) || parsed.exp * 1000 <= Date.now()) {
      return null;
    }
    if (!/^[a-f0-9]{64}$/.test(parsed.sid)) return null;
    return { sid: parsed.sid, exp: parsed.exp };
  } catch {
    return null;
  }
}

export function safeNextPath(value: string | undefined | null): string {
  if (!value) return "/";
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    return "/";
  }
  if (
    path.includes("\\") ||
    path.includes("://") ||
    /%2f%2f/i.test(path) ||
    /%5c/i.test(path)
  ) {
    return "/";
  }
  if (
    path === "/login" ||
    path.startsWith("/login?") ||
    path === "/signup" ||
    path.startsWith("/signup?")
  ) {
    return "/";
  }
  return path;
}
