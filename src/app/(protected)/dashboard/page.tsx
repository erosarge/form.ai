import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import { signOut } from "./actions";
import { DashboardClient } from "./DashboardClient";

export default async function DashboardPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard");
  }

  return (
    <main className="container stack">
      <div className="row wrap space-between" style={{ paddingBottom: 8 }}>
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: "#8fba24",
            letterSpacing: "-0.03em",
            fontFamily: "inherit",
          }}
        >
          FormAI
        </div>
        <form action={signOut}>
          <button className="iconBtn" type="submit" title="Sign out" aria-label="Sign out">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </form>
      </div>
      <DashboardClient />
    </main>
  );
}
