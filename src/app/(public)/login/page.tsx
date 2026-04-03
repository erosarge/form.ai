import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

function LoginFallback() {
  return (
    <main className="container stack">
      <h1>Login</h1>
      <div className="card stack" style={{ maxWidth: 420 }}>
        <div className="muted">Loading…</div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}
