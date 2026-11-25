import { NextResponse } from "next/server";
import {
  GOOGLE_OAUTH_COOKIE,
  createGoogleOauth,
  googleAuthUrl,
  googleConfigured,
} from "@/lib/google";
import { canSignSessions, safeNextPath } from "@/lib/session-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function oauthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
    maxAge: 60 * 10,
  };
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const nextPath = safeNextPath(url.searchParams.get("next"));
  const back = new URL("/login", url.origin);
  if (nextPath !== "/") back.searchParams.set("next", nextPath);

  if (!googleConfigured() || !canSignSessions()) {
    back.searchParams.set("error", "google-not-configured");
    return NextResponse.redirect(back);
  }

  const oauth = createGoogleOauth(nextPath);
  if (!oauth) {
    back.searchParams.set("error", "google-not-configured");
    return NextResponse.redirect(back);
  }

  const response = NextResponse.redirect(
    googleAuthUrl({
      origin: url.origin,
      state: oauth.state,
      challenge: oauth.challenge,
    }),
  );
  response.cookies.set(GOOGLE_OAUTH_COOKIE, oauth.seal, oauthCookieOptions());
  return response;
}
