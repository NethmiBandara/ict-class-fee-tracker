"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { loginAction, signupAction, type AuthFormState } from "@/lib/auth-actions";

function otherHref(mode: "login" | "signup", nextPath: string) {
  const target = mode === "login" ? "/signup" : "/login";
  if (!nextPath || nextPath === "/") return target;
  return `${target}?next=${encodeURIComponent(nextPath)}`;
}

export function AuthCard({
  mode,
  nextPath,
}: {
  mode: "login" | "signup";
  nextPath: string;
}) {
  const action = mode === "login" ? loginAction : signupAction;
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    action,
    {},
  );
  const [showPassword, setShowPassword] = useState(false);
  const isSignup = mode === "signup";

  return (
    <div className="auth-stage">
      <div className="auth-orb auth-orb-a" aria-hidden="true" />
      <div className="auth-orb auth-orb-b" aria-hidden="true" />
      <div className="auth-orb auth-orb-c" aria-hidden="true" />
      <div className="auth-grid" aria-hidden="true" />

      <div className="auth-layout">
        <section className="auth-story" aria-hidden="true">
          <p className="eyebrow">ICT class fees</p>
          <h1>Fees, attendance, and class days in one place.</h1>
          <p>
            Sign in to record payments, mark who came, and follow the month
            without losing a class day.
          </p>
          <div className="auth-chips">
            <div className="auth-float auth-float-1">
              <span>Classes</span>
              <strong>Fees in LKR</strong>
            </div>
            <div className="auth-float auth-float-2">
              <span>Attendance</span>
              <strong>Present by day</strong>
            </div>
            <div className="auth-float auth-float-3">
              <span>Reports</span>
              <strong>Month and year</strong>
            </div>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-brand">
            <span className="nav-brand-mark" aria-hidden="true" />
            <div>
              <p className="auth-kicker">
                {isSignup ? "New here" : "Welcome back"}
              </p>
              <h2>{isSignup ? "Create an account" : "Sign in"}</h2>
            </div>
          </div>

          <form
            key={`${state.error ?? ""}:${state.email ?? ""}:${state.name ?? ""}`}
            action={formAction}
            className="auth-form"
          >
            <input type="hidden" name="next" value={nextPath} />
            {isSignup ? (
              <div className="auth-field">
                <label htmlFor="auth-name">Name</label>
                <input
                  id="auth-name"
                  className="field"
                  name="name"
                  type="text"
                  autoComplete="name"
                  placeholder="Your name"
                  defaultValue={state.name}
                  required
                  minLength={2}
                  maxLength={80}
                />
              </div>
            ) : null}
            <div className="auth-field">
              <label htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                className="field"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@school.lk"
                defaultValue={state.email}
                required
                maxLength={160}
                spellCheck={false}
              />
            </div>
            <div className="auth-field">
              <label htmlFor="auth-password">Password</label>
              <span className="auth-password">
                <input
                  id="auth-password"
                  className="field"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  placeholder={isSignup ? "At least 8 characters" : "Your password"}
                  required
                  minLength={isSignup ? 8 : undefined}
                  maxLength={200}
                />
                <button
                  type="button"
                  className="auth-reveal"
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
            </div>
            {isSignup ? (
              <div className="auth-field">
                <label htmlFor="auth-confirm">Confirm password</label>
                <input
                  id="auth-confirm"
                  className="field"
                  name="confirm"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Repeat the password"
                  required
                  minLength={8}
                  maxLength={200}
                />
              </div>
            ) : null}

            {state.error ? (
              <p className="auth-error" role="alert" key={state.error}>
                {state.error}
              </p>
            ) : null}

            <button className="btn-primary auth-submit" type="submit" disabled={pending}>
              {pending ? <span className="auth-spinner" aria-hidden="true" /> : null}
              {pending
                ? isSignup
                  ? "Creating account"
                  : "Signing in"
                : isSignup
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>

          <p className="auth-note">
            Everyone who signs in shares the same classes, students, and
            payments.
          </p>
          <p className="auth-switch">
            {isSignup ? "Already have an account?" : "Need an account?"}{" "}
            <Link href={otherHref(mode, nextPath)}>
              {isSignup ? "Sign in" : "Create one"}
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
