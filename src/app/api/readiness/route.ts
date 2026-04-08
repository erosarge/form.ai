import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import { fetchIntervalsRecent } from "@/lib/intervals/intervals-client";

function getAnthropicEnv() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-0";
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY in environment.");
  return { apiKey, model };
}

const SHARED_RULES = [
  "Be direct, specific, and concise. Sound like an experienced coach.",
  "No markdown, no lists, plain paragraphs only. Maximum 4-5 sentences total.",
  "",
  "LANGUAGE RULES — follow strictly:",
  "- Never use the acronyms TSB, CTL, ATL, or Form. Translate them into plain English.",
  "- Instead of CTL say things like 'your fitness base is solid' or 'you've built a strong base over the past weeks'.",
  "- Instead of ATL say things like 'you've been carrying a good training load this week' or 'the fatigue from recent sessions is still in your legs'.",
  "- Instead of TSB/Form say things like 'you're carrying good freshness today' or 'you need another day before going hard'.",
  "- Never mention any of these acronyms even in passing.",
  "",
  "ACTIVITY DATA RULES — follow strictly, no exceptions:",
  "- Never invent, assume, or imply any activity not explicitly listed in the data.",
  "- Never call a run a 'half marathon' unless the distance is at least 21 km. Use the actual distance.",
].join("\n");

const PRE_WORKOUT_SYSTEM_PROMPT = [
  "You are generating a morning readiness report for Eros, an endurance athlete targeting sub-80 minute half marathon and sub-17 minute 5k.",
  SHARED_RULES,
  "",
  "YESTERDAY RULES — follow strictly:",
  "- Look at the RECENT ACTIVITIES list. If there is no activity listed for yesterday's date, the athlete rested yesterday.",
  "- When the athlete rested yesterday, say so naturally (e.g. 'after a rest day yesterday', 'you rested yesterday', 'coming off a rest day').",
  "- NEVER say 'another training day' or imply yesterday was a training day when there is no activity listed for that date.",
  "",
  "STRUCTURE:",
  "1. A short greeting to Eros.",
  "2. One sentence overall readiness assessment.",
  "3. Two or three sentences explaining what the data shows — HRV, sleep, recent training load, and what happened yesterday (training or rest) — in plain coach language.",
  "4. One final sentence that is a specific workout suggestion. Choose exactly one: a long easy run, an interval session, a tempo run, a short recovery run, a strength and gym session, or a rest day. Phrase it naturally.",
].join("\n");

const POST_WORKOUT_HARD_SYSTEM_PROMPT = [
  "You are generating a post-hard-session recovery brief for Eros, an endurance athlete targeting sub-80 minute half marathon and sub-17 minute 5k.",
  SHARED_RULES,
  "",
  "STRUCTURE:",
  "1. Acknowledge today's session by its exact name and distance — brief and warm.",
  "2. Tell Eros the hard work is done and recovery is now the priority.",
  "3. Give two concrete recovery actions: eat a proper meal within 30-45 minutes if not already done, stay on top of hydration, and keep any remaining movement light or skip it entirely.",
  "4. Sleep tonight is critical — target 8 or more hours to let the adaptation happen.",
  "5. One sentence previewing tomorrow — should be easy or rest based on current fatigue level.",
].join("\n");

const POST_WORKOUT_EASY_SYSTEM_PROMPT = [
  "You are generating a post-easy-session brief for Eros, an endurance athlete targeting sub-80 minute half marathon and sub-17 minute 5k.",
  SHARED_RULES,
  "",
  "STRUCTURE:",
  "1. Acknowledge today's session by name and note it was light or easy.",
  "2. One sentence on how Eros is doing — reference HRV, freshness, or recent load briefly.",
  "3. If the athlete looks fresh (positive or near-zero form score), suggest one optional complementary activity for later — e.g. 20 minutes of strength work, a short walk, or stretching. If fatigued, affirm rest.",
  "4. One evening recommendation — stay hydrated, eat well, get to bed at a reasonable time.",
].join("\n");

const EVENING_SYSTEM_PROMPT = [
  "You are generating an evening check-in for Eros, an endurance athlete targeting sub-80 minute half marathon and sub-17 minute 5k.",
  SHARED_RULES,
  "",
  "STRUCTURE:",
  "1. Note the day is coming to an end. No judgment on not training — just acknowledge it matter-of-factly.",
  "2. Sleep recommendation: based on this week's accumulated training load, give a specific target — heavier weeks need more recovery (e.g. 'aim for 8 to 9 hours tonight').",
  "3. One sentence previewing tomorrow — what kind of session makes sense based on current fatigue and readiness.",
].join("\n");

type ReportState = "pre-workout" | "post-workout-hard" | "post-workout-easy" | "evening";
type ClientState = "pre-workout" | "post-workout" | "evening";

interface TodayActivity {
  name: string;
  distanceM: number | null;
  avgHr: number | null;
  trainingLoad: number | null;
  type: string | null;
}

function determineState(currentHour: number, todayActivities: TodayActivity[]): ReportState {
  if (todayActivities.length > 0) {
    const hasHard = todayActivities.some(
      (a) =>
        (a.trainingLoad != null && a.trainingLoad > 40) ||
        (a.avgHr != null && a.avgHr > 145),
    );
    return hasHard ? "post-workout-hard" : "post-workout-easy";
  }
  if (currentHour >= 19) return "evening";
  return "pre-workout";
}

function stateToClientLabel(state: ReportState): ClientState {
  if (state === "post-workout-hard" || state === "post-workout-easy") return "post-workout";
  if (state === "evening") return "evening";
  return "pre-workout";
}

function systemPromptForState(state: ReportState): string {
  switch (state) {
    case "post-workout-hard":
      return POST_WORKOUT_HARD_SYSTEM_PROMPT;
    case "post-workout-easy":
      return POST_WORKOUT_EASY_SYSTEM_PROMPT;
    case "evening":
      return EVENING_SYSTEM_PROMPT;
    default:
      return PRE_WORKOUT_SYSTEM_PROMPT;
  }
}

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

  const todayDate = new Date().toISOString().slice(0, 10);
  const yesterdayMs = Date.now() - 86400000;
  const yesterdayDate = new Date(yesterdayMs).toISOString().slice(0, 10);

  // Determine state from client-provided context
  const currentHour = typeof body.currentHour === "number" ? body.currentHour : new Date().getHours();
  const todayActivities: TodayActivity[] = Array.isArray(body.todayActivities)
    ? (body.todayActivities as TodayActivity[])
    : [];

  const state = determineState(currentHour, todayActivities);
  const clientState = stateToClientLabel(state);
  const systemPrompt = systemPromptForState(state);

  // Fetch recent activities for context
  let recentActivitiesSummary = "No recent activity data available.";
  try {
    const recent = await fetchIntervalsRecent({ days: 7, limit: 15 });
    const activities = Array.isArray(recent.activities) ? recent.activities : [];
    if (activities.length === 0) {
      recentActivitiesSummary = "No activities recorded in the last 7 days.";
    } else {
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

  // Build today's sessions summary for post-workout states
  let todaySessionsSummary = "No session recorded today.";
  if (todayActivities.length > 0) {
    todaySessionsSummary = todayActivities
      .map((a) => {
        const distKm = a.distanceM != null ? `${(a.distanceM / 1000).toFixed(2)} km` : null;
        const hr = a.avgHr != null ? `avg HR ${Math.round(a.avgHr)} bpm` : null;
        const load = a.trainingLoad != null ? `training load ${Math.round(a.trainingLoad)}` : null;
        return [a.name ?? "Session", a.type, distKm, hr, load].filter(Boolean).join(", ");
      })
      .join("\n");
  }

  const userMessage = [
    `STATE: ${state} (hour: ${currentHour})`,
    "",
    `TODAY: ${todayDate}`,
    `YESTERDAY: ${yesterdayDate}`,
    "",
    "TODAY'S SESSION(S):",
    todaySessionsSummary,
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
    `RECENT ACTIVITIES (last 7 days, sorted newest first; if no activity listed for ${yesterdayDate} the athlete rested):`,
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
      system: systemPrompt,
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

  return NextResponse.json({ report, state: clientState });
}
