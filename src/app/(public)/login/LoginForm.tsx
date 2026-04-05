"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const next = searchParams.get("next") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<
    | { type: "idle" }
    | { type: "loading" }
    | { type: "error"; message: string }
  >({ type: "idle" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ type: "loading" });

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setStatus({ type: "error", message: error.message });
      return;
    }

    router.replace(next);
    router.refresh();
  }

  return (
    <>
      <header className="siteHeader">
        <span className="logo">FormAI</span>
      </header>
      <main className="container" style={{ display: "flex", alignItems: "flex-start", paddingTop: 48 }}>
        <div className="card stack" style={{ maxWidth: 400, width: "100%" }}>
          <p
            style={{
              margin: 0,
              fontSize: 10,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "var(--text-secondary)",
            }}
          >
            Sign in
          </p>
          <form className="stack" onSubmit={onSubmit} style={{ gap: 14 }}>
            <label className="stack" style={{ gap: 6 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: "var(--text-muted)",
                }}
              >
                Email
              </span>
              <input
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>

            <label className="stack" style={{ gap: 6 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: "var(--text-muted)",
                }}
              >
                Password
              </span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>

            <button
              className="button"
              type="submit"
              disabled={status.type === "loading"}
              style={{ marginTop: 4 }}
            >
              {status.type === "loading" ? "Signing in…" : "Sign in"}
            </button>

            {status.type === "error" ? (
              <div className="error">{status.message}</div>
            ) : null}
          </form>
        </div>
      </main>
    </>
  );
}
