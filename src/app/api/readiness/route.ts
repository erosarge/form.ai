import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";

function getAnthropicEnv() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-0";
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY in environment.");
  return { apiKey, model };
}

const READINESS_SYSTEM_PROMPT =
  "You are generating a morning readiness report for Eros, an endurance athlete targeting sub-80 minute half marathon and sub-17 minute 5k. Be direct, specific, and concise. Sound like an experienced coach giving a pre-session briefing. No markdown, no lists, plain paragraphs only. Maximum 4 sentences total.";

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
    `HRV last night: ${fmtNum(hrvLastNight, 1)}ms`,
    `HRV 7-day average: ${fmtNum(hrv7DayAvg, 1)}ms (${hrv7DayStatus ?? "trend unknown"})`,
    `Resting HR: ${fmtNum(restingHr)} bpm`,
    `Sleep score: ${fmtNum(sleepScore)}/100`,
    `Sleep duration: ${fmtSleep(sleepSecs)}`,
    `Form (TSB): ${fmtForm(form)}`,
    `CTL: ${fmtNum(ctl)}`,
    `ATL: ${fmtNum(atl)}`,
    "",
    'Write it as: a short greeting to Eros, a one-sentence overall readiness assessment, 2-3 sentences explaining what the data shows, a recommendation starting with "Today:", and one watch-out sentence. Plain text only.',
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
