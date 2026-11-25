"use server";

import {
  authenticateUser,
  createAuthSession,
  registerUser,
} from "@ict/core";
import { redirect } from "next/navigation";
import { canSignSessions, safeNextPath } from "@/lib/session-token";
import { destroySession, writeSessionCookie } from "@/lib/session";

export type AuthFormState = {
  error?: string;
  name?: string;
  email?: string;
};

function entered(formData: FormData): Pick<AuthFormState, "name" | "email"> {
  return {
    name: String(formData.get("name") || ""),
    email: String(formData.get("email") || ""),
  };
}

function publicAuthError(error: unknown): string {
  if (error instanceof Error && error.name === "DatabaseConfigError") {
    return error.message;
  }
  if (error instanceof Error && error.message === "AUTH_SECRET is missing.") {
    return "Sign-in is not configured yet. Set AUTH_SECRET on the server.";
  }
  console.error(error);
  return "Could not reach the database. Try again in a moment.";
}

function unavailable(): AuthFormState | null {
  if (canSignSessions()) return null;
  return {
    error: "Sign-in is not configured yet. Set AUTH_SECRET on the server.",
  };
}

export async function loginAction(
  _state: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const blocked = unavailable();
  if (blocked) return blocked;

  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");
  const nextPath = safeNextPath(String(formData.get("next") || ""));
  const values = entered(formData);
  if (!email.trim() || !password) {
    return { ...values, error: "Enter your email and password." };
  }

  try {
    const user = await authenticateUser(email, password);
    if (!user) return { ...values, error: "Email or password is incorrect." };
    const session = await createAuthSession(user.id);
    await writeSessionCookie(session.id, session.expiresAt);
  } catch (error) {
    return { ...values, error: publicAuthError(error) };
  }

  redirect(nextPath);
}

export async function signupAction(
  _state: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const blocked = unavailable();
  if (blocked) return blocked;

  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  const values = entered(formData);
  if (password !== confirm) {
    return { ...values, error: "Passwords do not match." };
  }

  try {
    const result = await registerUser({
      name: values.name || "",
      email: values.email || "",
      password,
    });
    if (!result.ok) return { ...values, error: result.error };
    const session = await createAuthSession(result.user.id);
    await writeSessionCookie(session.id, session.expiresAt);
  } catch (error) {
    return { ...values, error: publicAuthError(error) };
  }

  redirect(safeNextPath(String(formData.get("next") || "")));
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
