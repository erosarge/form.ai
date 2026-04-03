"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

export default function LoginPage() {
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
    <main className="container stack">
      <h1>Login</h1>

      <div className="card stack" style={{ maxWidth: 420 }}>
        <form className="stack" onSubmit={onSubmit}>
          <label className="stack" style={{ gap: 6 }}>
            <span className="muted">Email</span>
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
            <span className="muted">Password</span>
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
          >
            {status.type === "loading" ? "Signing in…" : "Sign in"}
          </button>

          {status.type === "error" ? (
            <div className="error">{status.message}</div>
          ) : null}

          <div className="muted">
            You can create a user in Supabase Auth (Email) first, then sign in
            here.
          </div>
        </form>
      </div>
    </main>
  );
}

