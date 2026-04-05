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

// ── Context condensers ──────────────────────────────────────────────────────

function formatPaceSec(secPerKm: number | null): string | null {
  if (!secPerKm || !Number.isFinite(secPerKm) || secPerKm <= 0) return null;
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}/km`;
}

/** One line per lap: #N dist pace HR cadence VR SL */
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
        lap.avg_vertical_ratio != null ? `VR:${lap.avg_vertical_ratio.toFixed(1)}%` : null,
        lap.avg_stride_length_m != null ? `SL:${lap.avg_stride_length_m.toFixed(2)}m` : null,
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
        vertical_ratio_increased: trends.vertical_ratio_increased,
        gct_increased: trends.gct_increased,
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
  recentActivities: any[];
  wellnessSummary: string;
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
      activityId = defaultRunActivityId(recent.activities);
    }

    if (activityId) {
      try {
        const [activityDetail, streams] = await Promise.all([
          fetchIntervalsActivityDetail(activityId, { intervals: true }),
          loadStreamsWithFallback(activityId),
        ]);

        // ── TEMP DEBUG: log raw field names from Intervals.icu endpoints ──────
        const act = activityDetail as Record<string, unknown>;
        console.log(
          "[DEBUG] /activity/{id} top-level keys:",
          Object.keys(act),
        );
        // Check first icu_interval for running dynamics fields
        const icuIntervals = Array.isArray(act.icu_intervals) ? act.icu_intervals : [];
        if (icuIntervals.length > 0) {
          console.log(
            "[DEBUG] icu_intervals[0] keys:",
            Object.keys(icuIntervals[0] as object),
          );
          console.log(
            "[DEBUG] icu_intervals[0] running dynamics raw values:",
            JSON.stringify(
              Object.fromEntries(
                Object.entries(icuIntervals[0] as object).filter(([k]) =>
                  /vertical|ground_contact|stride|gct|oscillation|cadence/i.test(k),
                ),
              ),
            ),
          );
        }
        // Check laps array too
        const lapsRaw = Array.isArray(act.laps) ? act.laps : [];
        if (lapsRaw.length > 0) {
          console.log(
            "[DEBUG] activity.laps[0] keys:",
            Object.keys(lapsRaw[0] as object),
          );
          console.log(
            "[DEBUG] activity.laps[0] running dynamics raw values:",
            JSON.stringify(
              Object.fromEntries(
                Object.entries(lapsRaw[0] as object).filter(([k]) =>
                  /vertical|ground_contact|stride|gct|oscillation|cadence/i.test(k),
                ),
              ),
            ),
          );
        }
        // Log streams structure
        if (streams != null) {
          if (Array.isArray(streams)) {
            console.log(
              "[DEBUG] streams is an array of length",
              streams.length,
              "| stream types available:",
              streams.map((s: any) => s?.type ?? s?.stream_type ?? Object.keys(s ?? {})[0]),
            );
          } else if (typeof streams === "object") {
            console.log(
              "[DEBUG] streams is an object with keys:",
              Object.keys(streams as object),
            );
          }
        } else {
          console.log("[DEBUG] streams: null (all fetch attempts failed)");
        }
        // ── END TEMP DEBUG ────────────────────────────────────────────────────
        const summary = {
          id: activityId,
          name: pickString(act, ["name", "title"]),
          type: pickString(act, ["type"]),
          start: pickString(act, ["start_date_local", "start_date", "date"]),
          distance_m: act.distance,
          moving_time: act.moving_time,
        };

        const analysis = buildSessionAnalysisFromActivity(activityDetail, streams);

        const laps = "error" in analysis ? [] : (analysis as any).laps ?? [];
        sessionBlock = [
          "SESSION_TARGET_ACTIVITY_SUMMARY_JSON:",
          JSON.stringify(summary),
          "",
          `LAP_SUMMARY (≤20 laps; #N dist pace HR cadence VR SL):`,
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
