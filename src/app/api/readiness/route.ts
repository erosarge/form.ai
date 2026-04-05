import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import { fetchIntervalsRecent } from "@/lib/intervals/intervals-client";

function getAnthropicEnv() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-0";
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY in environment.");
  return { apiKey, model };
}

const READINESS_SYSTEM_PROMPT = [
  "You are generating a morning readiness report for Eros, an endurance athlete targeting sub-80 minute half marathon and sub-17 minute 5k.",
  "Be direct, specific, and concise. Sound like an experienced coach giving a pre-session briefing.",
  "No markdown, no lists, plain paragraphs only. Maximum 4 sentences total.",
  "",
  "LANGUAGE RULES — follow strictly:",
  "- Never use the acronyms TSB, CTL, ATL, or Form. These are internal training load numbers — translate them into plain English instead.",
  "- Instead of CTL say things like 'your fitness base is solid', 'you've built a strong base over the past weeks', or 'your aerobic foundation is in good shape'.",
  "- Instead of ATL say things like 'you've been carrying a good training load this week', 'your body is under significant load right now', or 'the fatigue from recent sessions is still in your legs'.",
  "- Instead of TSB/Form say things like 'you're carrying good freshness today', 'you're well recovered and ready to push', or 'you need another day before going hard'.",
  "- Never mention any of these acronyms even in passing — no parenthetical explanations, no 'your form (TSB)' constructions.",
  "",
  "ACTIVITY DATA RULES — follow strictly, no exceptions:",
  "- Never invent, assume, or imply any activity that is not explicitly listed in RECENT ACTIVITIES with a specific date.",
  "- TODAY and YESTERDAY dates are provided explicitly. Use them to identify which activities happened on each day.",
  "- If there is no activity listed for YESTERDAY's date, the athlete rested yesterday. Say so plainly: 'you rested yesterday'.",
  "- Never call a run a 'half marathon' unless the distance is at least 21 km. A 13 km run is a 13 km run. A 10 km run is a 10 km run. Use the actual distance from the data — do not round up to the nearest race distance.",
  "",
  "STRUCTURE:",
  "1. A short greeting to Eros.",
  "2. One sentence overall readiness assessment.",
  "3. Two or three sentences explaining what the data shows — HRV, sleep, recent training load, and what happened yesterday — in plain coach language.",
  "4. One final sentence that is a specific workout suggestion. Choose exactly one: a long easy run, an interval session, a tempo run, a short recovery run, a strength and gym session, or a rest day. Phrase it naturally, for example: 'A tempo run today would be a smart choice given how fresh you are.' or 'A 40 minute easy run is all your body needs today — save the quality for tomorrow.' or 'Take the day off — let the adaptation happen.'",
].join("\n");

function fmtNum(v: number | null, decimals = 0): string {
  if (v == null) return "unavailable";
  return decimals > 0 ? v.toFixed(decimals) : Math.round(v).toString();
}

function fmtSleep(secs: number | null): string {
  if (secs == null) return "unavailable";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

function fmtForm(form: number | null): string {
  if (form == null) return "unavailable";
  return `${form > 0 ? "+" : ""}${form.toFixed(1)}`;
}

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { apiKey, model } = getAnthropicEnv();

  // Compute today and yesterday in local ISO date (YYYY-MM-DD)
  const todayDate = new Date().toISOString().slice(0, 10);
  const yesterdayMs = Date.now() - 86400000;
  const yesterdayDate = new Date(yesterdayMs).toISOString().slice(0, 10);

  // Fetch recent activities for context
  let recentActivitiesSummary = "No recent activity data available.";
  try {
    const recent = await fetchIntervalsRecent({ days: 7, limit: 15 });
    const activities = Array.isArray(recent.activities) ? recent.activities : [];
    if (activities.length === 0) {
      recentActivitiesSummary = "No activities recorded in the last 7 days.";
    } else {
      // Sort newest first so the most recent session is always at the top
      const sorted = [...activities].sort((a: any, b: any) => {
        const da = (a.start_date_local ?? a.date ?? "").slice(0, 10);
        const db = (b.start_date_local ?? b.date ?? "").slice(0, 10);
        return db.localeCompare(da);
      });
      const lines = sorted.map((a: any) => {
        const date = (a.start_date_local ?? a.date ?? "").slice(0, 10);
        const type = a.type ?? "Unknown";
        const distKm =
          a.distance != null ? `${(a.distance / 1000).toFixed(2)} km` : null;
        const durMin =
          a.moving_time != null
            ? `${Math.round(a.moving_time / 60)} min`
            : a.elapsed_time != null
              ? `${Math.round(a.elapsed_time / 60)} min`
              : null;
        return [date, type, distKm, durMin].filter(Boolean).join(", ");
      });
      recentActivitiesSummary = lines.join("\n");
    }
  } catch {
    // Non-fatal: proceed without activity context
  }

  const num = (k: string) => {
    const v = body[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const str = (k: string) => {
    const v = body[k];
    return typeof v === "string" && v.trim() ? v : null;
  };

  const hrvLastNight = num("hrvLastNight");
  const hrv7DayAvg = num("hrv7DayAvg");
  const hrv7DayStatus = str("hrv7DayStatus");
  const restingHr = num("restingHr");
  const sleepScore = num("sleepScore");
  const sleepSecs = num("sleepSecs");
  const form = num("form");
  const ctl = num("ctl");
  const atl = num("atl");

  const userMessage = [
    "Generate a morning readiness report based on this data:",
    "",
    `TODAY: ${todayDate}`,
    `YESTERDAY: ${yesterdayDate}`,
    "",
    "RECOVERY METRICS:",
    `HRV last night: ${fmtNum(hrvLastNight, 1)}ms`,
    `HRV 7-day average: ${fmtNum(hrv7DayAvg, 1)}ms (${hrv7DayStatus ?? "trend unknown"})`,
    `Resting HR: ${fmtNum(restingHr)} bpm`,
    `Sleep score: ${fmtNum(sleepScore)}/100`,
    `Sleep duration: ${fmtSleep(sleepSecs)}`,
    "",
    "TRAINING LOAD (translate to plain English — never use the acronym names):",
    `Freshness score: ${fmtForm(form)}`,
    `Fitness base score: ${fmtNum(ctl)}`,
    `Recent load score: ${fmtNum(atl)}`,
    "",
    `RECENT ACTIVITIES (last 7 days, sorted newest first — each line is one session with its exact date; if no activity is listed for ${yesterdayDate} (YESTERDAY), the athlete rested):`,
    recentActivitiesSummary,
  ].join("\n");

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      system: READINESS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!anthropicRes.ok) {
    const text = await anthropicRes.text().catch(() => "");
    return NextResponse.json(
      { error: `Claude API error (${anthropicRes.status}): ${text || anthropicRes.statusText}` },
      { status: 502 },
    );
  }

  const json = await anthropicRes.json();
  const report: string = json?.content?.[0]?.text ?? "";

  return NextResponse.json({ report });
}
