import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import { SettingsClient } from "./SettingsClient";

export default async function SettingsPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="container stack">
      <SettingsClient userEmail={user?.email} />
    </main>
  );
}
