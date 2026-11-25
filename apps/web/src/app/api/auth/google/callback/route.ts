import { createAuthSession, signInWithGoogle } from "@ict/core";
import { NextResponse, type NextRequest } from "next/server";
import {
  GOOGLE_OAUTH_COOKIE,
  exchangeGoogleCode,
  readGoogleOauth,
  sameSecret,
} from "@/lib/google";
import {
  SESSION_COOKIE,
  safeNextPath,
  signSessionToken,
} from "@/lib/session-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AGE = 60 * 60 * 24 * 14;

function loginRedirect(origin: string, error: string, nextPath: string) {
  const url = new URL("/login", origin);
  url.searchParams.set("error", error);
  if (nextPath !== "/") url.searchParams.set("next", nextPath);
  const response = NextResponse.redirect(url);
  response.cookies.set(GOOGLE_OAUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const oauth = readGoogleOauth(request.cookies.get(GOOGLE_OAUTH_COOKIE)?.value);
  const nextPath = safeNextPath(oauth?.next);
  const returnedState = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";

  if (url.searchParams.get("error") || !oauth || !code) {
    return loginRedirect(
      url.origin,
      url.searchParams.get("error") === "access_denied"
        ? "google-denied"
        : "google-invalid",
      nextPath,
    );
  }
  if (!sameSecret(oauth.state, returnedState)) {
    return loginRedirect(url.origin, "google-invalid", nextPath);
  }

  try {
    const profile = await exchangeGoogleCode({
      origin: url.origin,
      code,
      verifier: oauth.verifier,
    });
    if (!profile) return loginRedirect(url.origin, "google-invalid", nextPath);
    const linked = await signInWithGoogle(profile);
    if (!linked.ok) {
      const error = linked.error.includes("verified")
        ? "google-unverified"
        : linked.error.includes("different Google")
          ? "google-taken"
          : "google-invalid";
      return loginRedirect(url.origin, error, nextPath);
    }

    const session = await createAuthSession(linked.user.id);
    const token = signSessionToken({ sid: session.id, exp: session.expiresAt });
    if (!token) return loginRedirect(url.origin, "google-not-configured", nextPath);

    const response = NextResponse.redirect(new URL(nextPath, url.origin));
    response.cookies.set(GOOGLE_OAUTH_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth/google",
      maxAge: 0,
    });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: Math.min(
        MAX_AGE,
        Math.max(60, session.expiresAt - Math.floor(Date.now() / 1000)),
      ),
    });
    return response;
  } catch (error) {
    console.error(error);
    return loginRedirect(url.origin, "google-invalid", nextPath);
  }
}
