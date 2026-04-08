import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import { fetchIntervalsAthleteProfile } from "@/lib/intervals/intervals-client";

export async function GET() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const profile = (await fetchIntervalsAthleteProfile()) as Record<
      string,
      unknown
    >;
    const name =
      (profile?.name as string | undefined) ??
      (profile?.firstName as string | undefined) ??
      null;
    return NextResponse.json({ name });
  } catch {
    return NextResponse.json({ name: null });
  }
}
