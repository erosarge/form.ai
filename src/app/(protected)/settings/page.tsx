import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import { signOut } from "../actions";

export default async function SettingsPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="container stack">
      <div className="card stack">
        <p className="sectionTitle">Athlete</p>
        <div>
          <div style={{ fontWeight: 600, fontSize: 20, color: "var(--text)" }}>
            Emilio
          </div>
          {user?.email && (
            <div className="muted" style={{ marginTop: 4 }}>
              {user.email}
            </div>
          )}
        </div>
      </div>

      <div className="card stack">
        <p className="sectionTitle">Goals</p>
        <div className="stack" style={{ gap: 10 }}>
          <div className="settingsGoal">
            <span className="settingsGoalLabel">Half Marathon</span>
            <span className="settingsGoalTarget">Sub 80 min</span>
          </div>
          <div className="settingsGoal">
            <span className="settingsGoalLabel">5K</span>
            <span className="settingsGoalTarget">Sub 17 min</span>
          </div>
        </div>
      </div>

      <form action={signOut}>
        <button
          className="button"
          type="submit"
          style={{
            background: "var(--danger)",
            color: "#fff",
            width: "100%",
          }}
        >
          Sign Out
        </button>
      </form>
    </main>
  );
}
