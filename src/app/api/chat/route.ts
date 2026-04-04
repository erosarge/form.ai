import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import {
  fetchIntervalsActivityDetail,
  fetchIntervalsActivityStreams,
  fetchIntervalsAthleteProfile,
  fetchIntervalsRecent,
} from "@/lib/intervals/intervals-client";
import { buildSessionAnalysisFromActivity } from "@/lib/intervals/session-analysis";
import {
  resolveActivityIdForChat,
  sortActivitiesNewestFirst,
  wantsSessionDeepDive,
} from "@/lib/intervals/resolve-activity";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const ATHLETE_GOALS_CONTEXT = [
  "ATHLETE_LEVEL_AND_GOALS (use for pacing expectations and recommendations):",
  "- Experienced runner: marathon PR under 3 hours.",
  "- Current targets: sub-80 minute half marathon, sub-17 minute 5 km.",
  "- When coaching, calibrate interval quality and recovery against these goals; be specific about paces/efforts where data supports it.",
].join("\n");

function getAnthropicEnv() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-0";

  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY in environment.");
  }

  return { apiKey, model };
}

function clampInt(n: unknown, { min, max, fallback }: { min: number; max: number; fallback: number }) {
  const num = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function pickString(obj: Record<string, unknown>, keys: string[]) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function defaultRunActivityId(activities: unknown): string | null {
  const sorted = sortActivitiesNewestFirst(activities);
  if (!sorted.length) return null;
  const run = sorted.find((a) => {
    const t = (pickString(a, ["type"]) || "").toLowerCase();
    return t === "run" || t.includes("run");
  });
  const pick = run ?? sorted[0];
  return pickString(pick ?? {}, ["id"]);
}

const RUNNING_DYNAMICS_CONTEXT = [
  "RUNNING_DYNAMICS_INTERPRETATION (apply when these fields appear in laps, work_intervals, or single_effort_summary):",
  "- avg_vertical_ratio (%): energy efficiency — well-trained runners typically 6–8%; above 9% = energy wasted bouncing vertically.",
  "  Rising across laps/reps is a fatigue signal (form breakdown). Stable = good form discipline.",
  "- avg_ground_contact_time_ms (ms): lower = better elastic energy return; trained runners ~190–230ms.",
  "  Lengthening GCT across a session = neuromuscular fatigue / leg stiffness accumulating.",
  "- avg_stride_length_m (m): shortening under fatigue is a protective response; lengthening as pace increases is healthy mechanics.",
  "- avg_ground_contact_balance (%): 50% = perfect left/right symmetry; deviations >1–2% worth mentioning for injury risk.",
  "- avg_vertical_oscillation_cm (cm): lower = less energy wasted; reference alongside vertical ratio.",
  "Always describe dynamics trends in coach language, not raw numbers alone.",
  "Good examples: 'Your vertical ratio held at 7.1% across all six reps — excellent form consistency under fatigue'",
  "  or 'Ground contact time crept from 218ms to 247ms across the session — a clear sign of neuromuscular tiredness accumulating'",
  "  or 'Stride length shortened by ~8cm between rep 1 and rep 5, typical of muscle fatigue limiting push-off'.",
  "Only mention dynamics if the data is present (non-null). Skip gracefully if all null.",
].join("\n");

function buildSystemPrompt(parts: {
  athleteProfile: unknown;
  recent: unknown;
  sessionBlock?: string;
}) {
  return [
    "You are an expert running coach (AI) helping an athlete interpret a single session and training trends.",
    "When SESSION_INTERVAL_ANALYSIS_JSON is present:",
    "- It includes `session_classification` (session_type, rationale, metrics, ai_instructions) and optional `single_effort_summary`.",
    "- ALWAYS open your answer by stating the classified session type (INTERVAL_SESSION, STEADY_RUN, PROGRESSIVE_RUN, TEMPO_THRESHOLD, or MIXED_SESSION) and briefly WHY, using session_classification.rationale and metrics.",
    "- Then follow `session_classification.ai_instructions` exactly for how to analyse (e.g. rep-by-rep only for INTERVAL_SESSION; single block summary only for STEADY_RUN; do not lap-by-lap for steady).",
    "- For INTERVAL_SESSION: use work_intervals, recoveries, and trends for rep-by-rep and recovery HR drops.",
    "- For STEADY_RUN: use single_effort_summary and session totals — do NOT analyse lap-by-lap.",
    "- For PROGRESSIVE_RUN: emphasise pace trend vs lap/time order and HR response to increasing pace.",
    "- For TEMPO_THRESHOLD: emphasise sustained block, HR stability vs pace, threshold/lactate proxy signals, pacing discipline.",
    "- For MIXED_SESSION: name each phase (warm-up, main set, cool-down, etc.) and apply the right lens per phase.",
    "- Always end with session quality, fatigue signals, and ONE specific next-step recommendation tied to their goals.",
    "Keep tone practical and concise; use markdown headings.",
    "",
    ATHLETE_GOALS_CONTEXT,
    "",
    RUNNING_DYNAMICS_CONTEXT,
    "",
    parts.sessionBlock ? `${parts.sessionBlock}\n` : "",
    "ATHLETE_PROFILE_JSON:",
    JSON.stringify(parts.athleteProfile),
    "",
    "RECENT_INTERVALS_DATA_JSON (summary list — session detail may be in SESSION_INTERVAL_ANALYSIS_JSON):",
    JSON.stringify(parts.recent),
  ].join("\n");
}

async function* anthropicTextStream(response: Response): AsyncGenerator<string> {
  const body = response.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const sep = buffer.indexOf("\n\n");
      if (sep === -1) break;

      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      const lines = rawEvent.split("\n");
      const dataLines = lines
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice("data:".length).trim());

      const dataStr = dataLines.join("\n");
      if (!dataStr || dataStr === "[DONE]") continue;

      let payload: any;
      try {
        payload = JSON.parse(dataStr);
      } catch {
        continue;
      }

      if (payload?.type === "content_block_delta") {
        const text = payload?.delta?.text;
        if (typeof text === "string" && text.length) {
          yield text;
        }
      }
    }
  }
}

async function loadStreamsWithFallback(activityId: string) {
  const tryTypes = [
    "time,distance,watts,heart_rate,cadence,velocity_smooth",
    "time,distance,heart_rate,cadence",
    "",
  ];
  for (const types of tryTypes) {
    try {
      return await fetchIntervalsActivityStreams(activityId, types);
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const history = Array.isArray(body?.history) ? (body.history as ChatMessage[]) : [];

  if (!message) {
    return NextResponse.json({ error: "Missing message" }, { status: 400 });
  }

  const maxHistory = clampInt(body?.maxHistory, { min: 0, max: 20, fallback: 8 });
  const focusActivityId =
    typeof body?.focusActivityId === "string" ? body.focusActivityId.trim() : "";
  const deepSessionAnalysis =
    body?.deepSessionAnalysis === true || wantsSessionDeepDive(message);

  const maxTokens = clampInt(body?.maxTokens, {
    min: 256,
    max: 8192,
    fallback: deepSessionAnalysis ? 4096 : 1024,
  });

  const { apiKey, model } = getAnthropicEnv();

  const [athleteProfile, recent] = await Promise.all([
    fetchIntervalsAthleteProfile(),
    fetchIntervalsRecent({ days: 14, limit: 20 }),
  ]);

  let sessionBlock = "";

  if (deepSessionAnalysis) {
    let activityId = resolveActivityIdForChat({
      message,
      activities: recent.activities,
      explicitActivityId: typeof body?.activityId === "string" ? body.activityId : undefined,
      selectedActivityId: focusActivityId || undefined,
    });

    if (!activityId) {
      activityId = defaultRunActivityId(recent.activities);
    }

    if (activityId) {
      try {
        const [activityDetail, streams] = await Promise.all([
          fetchIntervalsActivityDetail(activityId, { intervals: true }),
          loadStreamsWithFallback(activityId),
        ]);

        const act = activityDetail as Record<string, unknown>;
        const summary = {
          id: activityId,
          name: pickString(act, ["name", "title"]),
          type: pickString(act, ["type"]),
          start: pickString(act, ["start_date_local", "start_date", "date"]),
          distance_m: act.distance,
          moving_time: act.moving_time,
        };

        const analysis = buildSessionAnalysisFromActivity(activityDetail, streams);

        sessionBlock = [
          "SESSION_TARGET_ACTIVITY_SUMMARY_JSON:",
          JSON.stringify(summary),
          "",
          "RAW_LAP_ROWS_JSON (distance m, duration s, pace s/km, HR, cadence, power per lap where available):",
          JSON.stringify("error" in analysis ? [] : analysis.laps),
          "",
          "SESSION_INTERVAL_ANALYSIS_JSON (phases, work/recovery summaries, trends — primary source for your breakdown):",
          JSON.stringify(analysis),
        ].join("\n");
      } catch (e) {
        sessionBlock = [
          "SESSION_INTERVAL_ANALYSIS_JSON:",
          JSON.stringify({
            error: e instanceof Error ? e.message : "Failed to load activity or streams",
            activityId,
          }),
        ].join("\n");
      }
    } else {
      sessionBlock =
        "SESSION_INTERVAL_ANALYSIS_JSON: {\"error\":\"No activity id could be resolved for lap analysis.\"}";
    }
  }

  const system = buildSystemPrompt({
    athleteProfile,
    recent,
    sessionBlock: sessionBlock || undefined,
  });

  const anthropicMessages = [
    ...history.slice(-maxHistory).map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: "user" as const, content: message },
  ];

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: anthropicMessages,
      stream: true,
    }),
  });

  if (!anthropicRes.ok) {
    const text = await anthropicRes.text().catch(() => "");
    return NextResponse.json(
      { error: `Claude API error (${anthropicRes.status}): ${text || anthropicRes.statusText}` },
      { status: 502 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of anthropicTextStream(anthropicRes)) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            `\n\n[stream error: ${e instanceof Error ? e.message : "unknown"}]`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
