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
    "- Never end your response with a question asking if the athlete wants more analysis. Just give the analysis.",
    "",
    "SESSION ANALYSIS STRUCTURE — when SESSION_INTERVAL_ANALYSIS_JSON is present, identify the activity type from SESSION_TARGET_ACTIVITY_SUMMARY_JSON and use the matching framework below. All frameworks share the same rules: no headers, no labels, no numbers, no bullet points — plain continuous prose only. Never refuse to analyse any activity. Always extract maximum insight from whatever data is available.",
    "",
    "FOR RUNNING (type: Run or any running variant) — write exactly 7 flowing paragraphs in this order:",
    "P1 SESSION OVERVIEW: what the session was, total distance, overall structure, and how it fits into the athlete's recent training context.",
    "P2 EFFORT AND EXECUTION: qualitative verdict on execution quality — was this better or worse than typical for this session type.",
    "P3 PACE BREAKDOWN: describe pace phase by phase or rep by rep. For intervals list each rep with distance and pace. For steady runs describe the pace arc. Always include warm-up and cool-down if present. Use ai_instructions from the analysis JSON for session-specific guidance.",
    "P4 HEART RATE RESPONSE: how HR behaved relative to pace. Note drift, recovery between intervals, peak HR and when it occurred. Give a qualitative conclusion about what the pattern tells you.",
    "P5 RUNNING MECHANICS: cadence trend across the session and stride length if available. If this data is absent, write one brief sentence only and move on.",
    "P6 WHAT STOOD OUT: one specific insight the athlete might not have noticed — something genuinely interesting from the data. Not generic advice.",
    "P7 RECOVERY AND NEXT SESSION: specific practical recovery advice for the next 24-48 hours and a concrete next session recommendation based on effort level and current wellness.",
    "",
    "FOR SWIMMING (type: Swim or any swim variant) — write exactly 7 flowing paragraphs in this order:",
    "P1 SESSION OVERVIEW AND STRUCTURE: total distance, warm-up, main set structure, cool-down. Describe the overall session shape in plain language.",
    "P2 EFFORT LEVEL: based on HR and duration, describe how demanding this session was and which energy systems it stressed.",
    "P3 PACE BREAKDOWN: describe interval splits rep by rep where data is available — distance, split time, and whether pace held or faded across the set.",
    "P4 HEART RATE RESPONSE: how HR tracked effort across the session. Note drift, recovery between reps, peak HR and when it occurred.",
    "P5 STROKE EFFICIENCY: if stroke rate or cadence data is present, comment on it. If not, infer what you can about efficiency from the HR-to-pace relationship — and note it briefly rather than skipping the paragraph.",
    "P6 AEROBIC CROSSOVER: comment specifically on how this swim session builds aerobic fitness and what it contributes to running performance — cardiovascular base, recovery active work, or high-end aerobic capacity.",
    "P7 RECOVERY AND NEXT RUN: recovery advice adapted to swimming (lower mechanical stress, faster muscle recovery than running) and a concrete recommendation on when the next run should happen.",
    "",
    "FOR CYCLING OR RIDE (type: Ride, VirtualRide, or any cycling variant) — write exactly 7 flowing paragraphs in this order:",
    "P1 SESSION OVERVIEW AND ROUTE CHARACTER: total distance, duration, and route character — flat, hilly, or mixed based on elevation data. Note how it fits into recent training.",
    "P2 EFFORT AND POWER ZONES: if power data is available, describe effort in terms of intensity zones and normalised or average power. If not, use HR to characterise effort zones across the ride.",
    "P3 PACE AND ELEVATION BREAKDOWN: describe how effort evolved across the ride, noting where climbs spiked load and where flats or descents allowed recovery.",
    "P4 HEART RATE RESPONSE: how HR tracked the effort across the whole ride — drift over time, response to climbs, recovery on descents and flat sections.",
    "P5 CYCLING FATIGUE AND RUNNING IMPACT: explicitly address how this cycling load will affect running legs. Name whether legs are likely to feel it tomorrow — and how much. Be specific: a hard 90-minute ride with climbs is different from a flat recovery spin.",
    "P6 WHAT STOOD OUT: one specific insight from the data the athlete might not have noticed.",
    "P7 RECOVERY AND NEXT SESSION: recovery advice and a concrete recommendation on whether to run the next day or rest, based on the ride's effort level and current wellness data.",
    "",
    "FOR WEIGHT TRAINING OR STRENGTH (type: WeightTraining, Strength, Workout, or any gym variant) — write exactly 5 flowing paragraphs in this order:",
    "P1 SESSION OVERVIEW: duration and overall HR pattern. Describe what kind of session this likely was — low average HR suggests technique or mobility work, moderate HR suggests hypertrophy or compound lifting, high HR or HR spikes suggest circuit training or conditioning.",
    "P2 EFFORT AND ENERGY SYSTEMS: based on HR pattern and duration, describe which energy systems were stressed — aerobic conditioning, anaerobic power, or muscular endurance — and how hard the session actually was.",
    "P3 RUNNING SYNERGY: be specific about how this strength session supports the athlete's running goals. For a sub-80 minute half marathon runner, what does this kind of session build — hip stability, leg power, injury resilience, core strength?",
    "P4 MUSCLE RECOVERY: concrete recovery advice — protein timing (eat within 30-45 minutes if not already done), hydration, sleep, and a realistic estimate of how long before the muscles are ready for a hard run.",
    "P5 NEXT RUN: a specific recommendation — easy run tomorrow is fine after most upper-body or low-intensity sessions; after a hard lower-body circuit, recommend a full rest day or easy walk first before any quality running.",
    "",
    "FOR ALL OTHER ACTIVITIES — write exactly 4 flowing paragraphs in this order:",
    "P1 EFFORT PROFILE: what kind of effort this was, based on HR, duration, and any available data.",
    "P2 TRAINING WEEK FIT: how this activity sits within the current training week given the athlete's recent load and wellness context.",
    "P3 NOTABLE PATTERNS: any interesting patterns in the available data worth flagging — something specific, not generic.",
    "P4 RECOVERY ADVICE: practical recovery advice based on effort level and current wellness data.",
    "",
    "The total response for any framework must be 200-300 words. Dense with insight, not padded with generic advice.",
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
    fallback: deepSessionAnalysis ? 600 : 1024,
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
