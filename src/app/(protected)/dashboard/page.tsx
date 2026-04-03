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
      <div className="row wrap space-between">
        <h1 style={{ margin: 0 }}>Dashboard</h1>
        <form action={signOut}>
          <button className="button" type="submit">
            Sign out
          </button>
        </form>
      </div>
      <DashboardClient />
    </main>
  );
}

