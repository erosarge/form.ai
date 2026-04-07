import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import {
  fetchIntervalsActivityDetail,
  fetchIntervalsActivityIntervals,
  fetchIntervalsActivityStreams,
  fetchIntervalsAthleteProfile,
  fetchIntervalsRecent,
} from "@/lib/intervals/intervals-client";
import { buildSessionAnalysisFromActivity } from "@/lib/intervals/session-analysis";
import {
  inferActivityTypeFilter,
  resolveActivityIdForChat,
  sortActivitiesNewestFirst,
  wantsSessionDeepDive,
} from "@/lib/intervals/resolve-activity";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

// ── Context condensers ──────────────────────────────────────────────────────

function formatPaceSec(secPerKm: number | null): string | null {
  if (!secPerKm || !Number.isFinite(secPerKm) || secPerKm <= 0) return null;
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}/km`;
}

/** One line per lap: #N dist pace HR cadence SL power */
function condenseLaps(laps: any[], maxLaps = 20): string {
  return laps
    .slice(0, maxLaps)
    .map((lap) => {
      return [
        `#${lap.index + 1}`,
        lap.distance_m != null ? `${Math.round(lap.distance_m)}m` : null,
        formatPaceSec(lap.pace_sec_per_km),
        lap.avg_hr != null ? `${Math.round(lap.avg_hr)}bpm` : null,
        lap.avg_cadence != null ? `${Math.round(lap.avg_cadence)}spm` : null,
        lap.avg_stride_length_m != null ? `SL:${lap.avg_stride_length_m.toFixed(2)}m` : null,
        lap.avg_power != null ? `${Math.round(lap.avg_power)}W` : null,
      ]
        .filter(Boolean)
        .join(" ");
    })
    .join("\n");
}

/** Strip raw laps + drift numbers; keep booleans, notes, and counts. */
function condenseAnalysis(analysis: any): any {
  if ("error" in analysis) return analysis;
  const { laps: _laps, trends, ...rest } = analysis;
  const condensedTrends = trends
    ? {
        work_interval_count: trends.work_interval_count,
        pace_degraded: trends.pace_degraded,
        hr_climbed_at_similar_pace: trends.hr_climbed_at_similar_pace,
        cadence_dropped: trends.cadence_dropped,
        power_held: trends.power_held,
        stride_length_shortened: trends.stride_length_shortened,
        notes: trends.notes,
      }
    : undefined;
  return { ...rest, trends: condensedTrends };
}

/** Slim each activity to the fields Claude actually needs for context. */
function condenseActivities(activities: unknown): any[] {
  const arr = Array.isArray(activities) ? activities : [];
  return arr.map((a: any) => ({
    id: a.id,
    date: a.start_date_local ?? a.date,
    type: a.type,
    name: a.name,
    distance_m: a.distance,
    moving_time_s: a.moving_time,
    avg_hr: a.average_heartrate ?? a.avg_hr ?? null,
    avg_pace: a.average_speed != null ? formatPaceSec(1000 / a.average_speed) : null,
  }));
}

/** Latest wellness entry only, as a one-line summary. */
function condenseWellness(wellness: unknown): string {
  const arr = Array.isArray(wellness) ? wellness : [];
  if (!arr.length) return "no wellness data";
  const w: any = arr[arr.length - 1];
  return [
    w.date ?? w.id ?? "latest",
    w.hrv != null ? `HRV:${w.hrv}` : w.hrvRmssd != null ? `HRV:${w.hrvRmssd}` : null,
    w.restingHR != null ? `RHR:${w.restingHR}` : null,
    w.sleepScore != null ? `sleep:${w.sleepScore}` : null,
    w.ctl != null ? `CTL:${Math.round(w.ctl)}` : null,
    w.atl != null ? `ATL:${Math.round(w.atl)}` : null,
    w.form != null ? `form:${Math.round(w.form)}` : null,
    w.spO2 != null ? `SpO2:${w.spO2}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

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

function defaultActivityId(activities: unknown, message: string): string | null {
  const sorted = sortActivitiesNewestFirst(activities);
  if (!sorted.length) return null;
  // Respect the activity type the user mentioned (e.g. "my last swim"), otherwise default to most recent run
  const typeFilter = inferActivityTypeFilter(message);
  if (typeFilter) {
    const match = sorted.find((a) => typeFilter(pickString(a, ["type"]) ?? ""));
    return pickString(match ?? sorted[0] ?? {}, ["id"]);
  }
  const run = sorted.find((a) => {
    const t = (pickString(a, ["type"]) || "").toLowerCase();
    return t === "run" || t.includes("run");
  });
  const pick = run ?? sorted[0];
  return pickString(pick ?? {}, ["id"]);
}

const RUNNING_DYNAMICS_CONTEXT = [
  "AVAILABLE METRICS FROM THIS DATA SOURCE:",
  "- Pace per lap (from distance + elapsed time or average_speed)",
  "- Heart rate per lap (average_heartrate)",
  "- Cadence per lap (steps per minute — already doubled from raw data)",
  "- Stride length per lap (avg_stride_length_m in meters)",
  "- Power per lap (avg_power in watts, if the athlete records it)",
  "- Elevation per lap (if present)",
  "",
  "METRICS NOT AVAILABLE FROM THIS DATA SOURCE — NEVER MENTION THEM:",
  "The following running dynamics metrics are NOT available from this data source.",
  "Do NOT mention them as missing, do NOT suggest the athlete enable them on their watch, do NOT reference them at all:",
  "- Vertical ratio / vertical oscillation",
  "- Ground contact time (GCT)",
  "- Ground contact balance (left/right balance)",
  "- Step speed loss",
  "",
  "STRIDE LENGTH INTERPRETATION (use when avg_stride_length_m is non-null):",
  "- Shortening under fatigue is a protective response: typical of muscle fatigue limiting push-off.",
  "- Lengthening as pace increases is healthy mechanics: more elastic energy return at higher speeds.",
  "- Describe in coach language: 'Your stride length shortened from 1.52m in rep 1 to 1.44m by the final rep — a sign of leg fatigue limiting push-off' or 'Stride length stayed consistent at 1.48m across all reps, showing good form discipline under fatigue'.",
  "Only mention stride length if the data is present (non-null). Skip gracefully if all null.",
].join("\n");

function buildSystemPrompt(parts: {
  athleteProfile: unknown;
  recentActivities: any[];
  wellnessSummary: string;
  sessionBlock?: string;
}) {
  return [
    "You are an experienced running coach having a conversation with an athlete you know well. You speak directly and naturally, like a real coach — not like a data analyst writing a report.",
    "",
    "FORMATTING RULES (follow without exception):",
    "- Never use markdown formatting. No # headers, no ** bold, no bullet points with dashes, no numbered lists. Write in plain flowing paragraphs only.",
    "- Never classify or label the session type out loud. Do not say 'this is an INTERVAL_SESSION' or 'session type: pyramid'. Instead describe it naturally: 'You ran a pyramid session yesterday' or 'Your long run on Saturday'.",
    "- Sound like a coach talking, not a report being written. Say 'Your cadence held up well through the session' not 'Cadence metrics indicate sustained neuromuscular output'.",
    "- Lead with the most interesting or important insight. Do not open with disclaimers about missing data. If data is missing, mention it briefly at the end.",
    "- Keep responses to 3 to 5 short paragraphs maximum unless the athlete explicitly asks for more detail.",
    "- Never end your response with a question asking if the athlete wants more analysis. Just give the analysis.",
    "",
    "COACHING CONTENT RULES:",
    "When SESSION_INTERVAL_ANALYSIS_JSON is present, use session_classification and ai_instructions to guide your focus:",
    "- For interval sessions: walk through the reps naturally, highlight how pace and HR evolved, call out recovery quality.",
    "- For steady runs: talk about the session as a whole — pace, HR, feel, not lap-by-lap.",
    "- For progressive runs: focus on how pace changed over time and whether HR responded as expected.",
    "- For tempo or threshold work: focus on whether the effort was sustained, how HR behaved, and pacing discipline.",
    "- For mixed sessions: briefly name each phase and apply the right lens per phase, in natural language.",
    "Always close with one specific, actionable next-step recommendation tied to the athlete's goals.",
    "",
    ATHLETE_GOALS_CONTEXT,
    "",
    RUNNING_DYNAMICS_CONTEXT,
    "",
    parts.sessionBlock ? `${parts.sessionBlock}\n` : "",
    "ATHLETE_PROFILE_JSON:",
    JSON.stringify(parts.athleteProfile),
    "",
    "RECENT_ACTIVITIES (condensed — id, date, type, distance, time, avg_hr, avg_pace):",
    JSON.stringify(parts.recentActivities),
    "",
    "WELLNESS_LATEST:",
    parts.wellnessSummary,
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
      activityId = defaultActivityId(recent.activities, message);
    }

    if (activityId) {
      try {
        const [activityDetail, streams, intervalsData] = await Promise.all([
          fetchIntervalsActivityDetail(activityId, { intervals: false }),
          loadStreamsWithFallback(activityId),
          fetchIntervalsActivityIntervals(activityId).catch(() => null),
        ]);

        // Merge icu_intervals from the /intervals endpoint into the activity object
        const icuIntervals =
          intervalsData &&
          typeof intervalsData === "object" &&
          Array.isArray((intervalsData as any).icu_intervals)
            ? (intervalsData as any).icu_intervals
            : null;

        const act = {
          ...(activityDetail as Record<string, unknown>),
          ...(icuIntervals ? { icu_intervals: icuIntervals } : {}),
        };

        const summary = {
          id: activityId,
          name: pickString(act, ["name", "title"]),
          type: pickString(act, ["type"]),
          start: pickString(act, ["start_date_local", "start_date", "date"]),
          distance_m: (act as any)["distance"] as number | undefined,
          moving_time: (act as any)["moving_time"] as number | undefined,
        };

        const analysis = buildSessionAnalysisFromActivity(act, streams);

        const laps = "error" in analysis ? [] : (analysis as any).laps ?? [];
        sessionBlock = [
          "SESSION_TARGET_ACTIVITY_SUMMARY_JSON:",
          JSON.stringify(summary),
          "",
          `LAP_SUMMARY (≤20 laps; #N dist pace HR cadence SL power):`,
          condenseLaps(laps),
          "",
          "SESSION_INTERVAL_ANALYSIS_JSON (phases, work/recovery summaries, trend conclusions — primary source for breakdown):",
          JSON.stringify(condenseAnalysis(analysis)),
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
    recentActivities: condenseActivities((recent as any).activities),
    wellnessSummary: condenseWellness((recent as any).wellness),
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
