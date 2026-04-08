import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";

export type UserSettings = {
  athlete_name: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  goal_5k: string | null;
  goal_10k: string | null;
  goal_half_marathon: string | null;
  goal_marathon: string | null;
  other_goals: string | null;
};

export async function GET() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", user.id)
    .single();

  // PGRST116 = no rows found — not an error, just no settings saved yet
  if (error && error.code !== "PGRST116") {
    console.error("[settings GET] Supabase error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? null);
}

export async function PUT(request: Request) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: UserSettings;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { error } = await supabase.from("user_settings").upsert({
    user_id: user.id,
    athlete_name: body.athlete_name ?? null,
    height_cm: body.height_cm ?? null,
    weight_kg: body.weight_kg ?? null,
    goal_5k: body.goal_5k ?? null,
    goal_10k: body.goal_10k ?? null,
    goal_half_marathon: body.goal_half_marathon ?? null,
    goal_marathon: body.goal_marathon ?? null,
    other_goals: body.other_goals ?? null,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[settings PUT] Supabase upsert error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
