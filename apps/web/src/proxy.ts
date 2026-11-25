import { NextResponse, type NextRequest } from "next/server";
import { readSessionToken, SESSION_COOKIE } from "@/lib/session-token";

const PUBLIC_PATHS = new Set([
  "/login",
  "/signup",
  "/api/health",
  "/apple-icon",
  "/api/auth/google",
  "/api/auth/google/callback",
]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const session = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  const login = new URL("/login", request.url);
  if (pathname !== "/") {
    login.searchParams.set("next", `${pathname}${search}`);
  }
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
