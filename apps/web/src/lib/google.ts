import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { openJson, sealJson } from "@/lib/session-token";

export const GOOGLE_OAUTH_COOKIE = "ict_google_oauth";
const OAUTH_SECONDS = 60 * 10;

export type GoogleOauthSeal = {
  state: string;
  verifier: string;
  next: string;
  exp: number;
};

const GOOGLE_ERRORS: Record<string, string> = {
  "google-denied": "Google sign-in was cancelled.",
  "google-invalid": "Google sign-in could not be completed. Try again.",
  "google-unverified": "That Google account has no verified email.",
  "google-not-configured": "Google sign-in is not set up on this server yet.",
  "google-taken": "That email is already linked to a different Google account.",
};

export function googleErrorMessage(code: string | undefined) {
  if (!code) return undefined;
  return GOOGLE_ERRORS[code];
}

export function googleConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim(),
  );
}

export function googleRedirectUri(origin: string) {
  return `${origin}/api/auth/google/callback`;
}

export function createGoogleOauth(nextPath: string): {
  seal: string;
  state: string;
  challenge: string;
} | null {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("hex");
  const seal = sealJson({
    state,
    verifier,
    next: nextPath,
    exp: Math.floor(Date.now() / 1000) + OAUTH_SECONDS,
  } satisfies GoogleOauthSeal);
  if (!seal) return null;
  return { seal, state, challenge };
}

export function readGoogleOauth(token: string | undefined): GoogleOauthSeal | null {
  const parsed = openJson<Partial<GoogleOauthSeal>>(token);
  if (!parsed) return null;
  if (
    typeof parsed.state !== "string" ||
    typeof parsed.verifier !== "string" ||
    typeof parsed.next !== "string" ||
    typeof parsed.exp !== "number"
  ) {
    return null;
  }
  if (!Number.isFinite(parsed.exp) || parsed.exp * 1000 <= Date.now()) return null;
  return {
    state: parsed.state,
    verifier: parsed.verifier,
    next: parsed.next,
    exp: parsed.exp,
  };
}

export function sameSecret(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function googleAuthUrl(input: {
  origin: string;
  state: string;
  challenge: string;
}) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", googleRedirectUri(input.origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url;
}

export type GoogleProfile = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

export async function exchangeGoogleCode(input: {
  origin: string;
  code: string;
  verifier: string;
}): Promise<GoogleProfile | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
  const body = new URLSearchParams({
    code: input.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: googleRedirectUri(input.origin),
    grant_type: "authorization_code",
    code_verifier: input.verifier,
  });
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!tokenResponse.ok) return null;
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) return null;

  const profileResponse = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!profileResponse.ok) return null;
  const profile = (await profileResponse.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
  };
  if (!profile.sub || !profile.email) return null;
  const verified =
    profile.email_verified === true || profile.email_verified === "true";
  return {
    sub: profile.sub,
    email: profile.email,
    emailVerified: verified,
    name: profile.name || "",
  };
}
