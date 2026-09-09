"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";

type AuthState = "checking" | "anonymous" | "authenticated";

type SessionPayload = {
  authenticated: true;
  username: string;
};

const ShieldMark = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 48 48"
    className="h-7 w-7"
    fill="none"
  >
    <path
      d="M24 4 40 10v12c0 10.8-6.7 18.4-16 22.8C14.7 40.4 8 32.8 8 22V10L24 4Z"
      stroke="currentColor"
      strokeWidth="2.4"
    />
    <path
      d="m17.5 24 4.2 4.2 9.3-9.4"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const AuthGate = () => {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    const loadSession = async () => {
      try {
        const response = await fetch("/api/auth/session", {
          signal: controller.signal,
        });
        if (response.ok) {
          const session = (await response.json()) as SessionPayload;
          setUsername(session.username);
          setAuthState("authenticated");
          return;
        }
        setAuthState("anonymous");
      } catch (sessionError) {
        if (
          sessionError instanceof Error &&
          sessionError.name === "AbortError"
        ) {
          return;
        }
        setError("Unable to connect to the server. Please try again.");
        setAuthState("anonymous");
      }
    };

    void loadSession();
    return () => controller.abort();
  }, []);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = (await response.json()) as
        | SessionPayload
        | { detail?: string };

      if (!response.ok) {
        throw new Error(
          "detail" in result && result.detail
            ? result.detail
            : "Sign in failed. Please try again.",
        );
      }

      const session = result as SessionPayload;
      setUsername(session.username);
      setPassword("");
      setAuthState("authenticated");
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Sign in failed. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        throw new Error("Sign out failed. Please try again.");
      }
      setUsername("");
      setPassword("");
      setAuthState("anonymous");
    } catch (logoutError) {
      setError(
        logoutError instanceof Error
          ? logoutError.message
          : "Sign out failed. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSessionExpired = useCallback(() => {
    setUsername("");
    setPassword("");
    setError("Your session expired. Please sign in again.");
    setAuthState("anonymous");
  }, []);

  if (authState === "checking") {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--page-bg)]">
        <div className="flex items-center gap-3 text-sm font-semibold text-[var(--navy-dark)]">
          <span className="h-3 w-3 animate-pulse rounded-full bg-[var(--primary-blue)]" />
          Loading workspace
        </div>
      </main>
    );
  }

  if (authState === "authenticated") {
    return (
      <KanbanBoard
        username={username}
        isLoggingOut={isSubmitting}
        onLogout={() => void handleLogout()}
        onSessionExpired={handleSessionExpired}
      />
    );
  }

  return (
    <main className="relative grid min-h-screen overflow-hidden bg-[var(--page-bg)] px-6 py-12 lg:grid-cols-[1.1fr_0.9fr] lg:px-12">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.24),_transparent_68%)]" />
      <div className="pointer-events-none absolute -bottom-44 -right-32 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18),_transparent_68%)]" />

      <section className="relative hidden flex-col justify-between p-10 lg:flex">
        <div className="flex items-center gap-3 font-display text-xl font-semibold text-[var(--navy-dark)]">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--navy-dark)] text-white">
            <ShieldMark />
          </span>
          Kanban Studio
        </div>
        <div className="max-w-xl pb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--primary-blue)]">
            Focused project delivery
          </p>
          <h1 className="mt-5 font-display text-6xl font-semibold leading-[1.05] tracking-[-0.04em] text-[var(--navy-dark)]">
            Keep the work moving forward.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-[var(--gray-text)]">
            A clear, secure workspace for turning priorities into progress.
          </p>
        </div>
        <p className="text-xs text-[var(--gray-text)]">
          Project Management MVP · Local workspace
        </p>
      </section>

      <section className="relative grid place-items-center">
        <div className="w-full max-w-md rounded-[32px] border border-[var(--stroke)] bg-white p-8 shadow-[0_28px_80px_rgba(3,33,71,0.14)] sm:p-10">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--navy-dark)] text-white">
              <ShieldMark />
            </span>
            <span className="font-display text-lg font-semibold text-[var(--navy-dark)]">
              Kanban Studio
            </span>
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--primary-blue)]">
            Welcome back
          </p>
          <h2 className="mt-4 font-display text-4xl font-semibold tracking-[-0.03em] text-[var(--navy-dark)]">
            Sign in to your workspace
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--gray-text)]">
            Enter your credentials to access the project board.
          </p>

          <form className="mt-8 space-y-5" onSubmit={handleLogin}>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--navy-dark)]">
                Username
              </span>
              <input
                name="username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-4 py-3.5 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)] focus:ring-4 focus:ring-sky-100"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--navy-dark)]">
                Password
              </span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-4 py-3.5 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)] focus:ring-4 focus:ring-sky-100"
                required
              />
            </label>

            {error ? (
              <p
                role="alert"
                className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-2xl bg-[var(--secondary-purple)] px-5 py-4 text-sm font-semibold text-white shadow-lg shadow-purple-900/15 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
            >
              {isSubmitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
};
