import "server-only";

type AnyRecord = Record<string, unknown>;

export type NormalizedLap = {
  index: number;
  distance_m: number | null;
  duration_s: number | null;
  pace_sec_per_km: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_cadence: number | null;
  avg_power: number | null;
  source: "device_lap" | "icu_interval" | "recovery_gap" | "stream_synthetic";
};

export type PhaseKind = "warm_up" | "work" | "recovery" | "cool_down" | "mixed";

export type SessionPhase = {
  label: string;
  kind: PhaseKind;
  lapIndices: number[];
  distance_m: number | null;
  duration_s: number | null;
  pace_sec_per_km: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_cadence: number | null;
  avg_power: number | null;
  /** Recovery-only: HR drop vs end of previous work phase (bpm) */
  hr_drop_from_prior_work_bpm: number | null;
};

export type WorkIntervalSummary = {
  label: string;
  lapIndices: number[];
  distance_m: number | null;
  pace_sec_per_km: number | null;
  pace_per_km: string | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_cadence: number | null;
  avg_power: number | null;
};

export type RecoverySummary = {
  label: string;
  lapIndices: number[];
  duration_s: number | null;
  avg_hr: number | null;
  hr_drop_from_prior_work_bpm: number | null;
};

export type SessionTrends = {
  work_interval_count: number;
  pace_drift_sec_per_km_per_rep: number | null;
  hr_drift_bpm_per_rep: number | null;
  cadence_drift_per_rep: number | null;
  power_drift_w_per_rep: number | null;
  pace_degraded: boolean | null;
  hr_climbed_at_similar_pace: boolean | null;
  cadence_dropped: boolean | null;
  power_held: boolean | null;
  notes: string[];
};

/** High-level session archetype — drives how the coach should analyse (see ai_instructions). */
export type SessionType =
  | "INTERVAL_SESSION"
  | "STEADY_RUN"
  | "PROGRESSIVE_RUN"
  | "TEMPO_THRESHOLD"
  | "MIXED_SESSION";

export type SessionClassification = {
  session_type: SessionType;
  /** Why this label was chosen (for coach to quote briefly). */
  rationale: string;
  metrics: {
    lap_pace_min_sec_km: number | null;
    lap_pace_max_sec_km: number | null;
    lap_pace_median_sec_km: number | null;
    lap_pace_range_sec_km: number | null;
    /** (max−min)/median on laps with valid pace. */
    relative_pace_spread: number | null;
    /** Linear slope of pace (sec/km) vs lap order; negative ⇒ pace getting faster. */
    pace_slope_sec_km_per_lap: number | null;
    total_moving_time_s: number | null;
    recovery_phase_count: number;
    work_phase_count: number;
    phase_count: number;
  };
  /** Exact instructions for the LLM for this session type. */
  ai_instructions: string;
};

/** Single-block summary for STEADY_RUN / parts of MIXED (do not use for rep-by-rep). */
export type SingleEffortSummary = {
  label: string;
  avg_pace_sec_km: number | null;
  avg_pace_per_km: string | null;
  weighted_avg_hr: number | null;
  /** Avg HR first third of laps vs last third (bpm difference, positive = drift up). */
  hr_drift_first_to_last_third_bpm: number | null;
  avg_cadence: number | null;
  cadence_cv: number | null;
  total_distance_m: number | null;
  total_duration_s: number | null;
};

export type SessionAnalysis = {
  lap_count: number;
  laps: NormalizedLap[];
  phases: SessionPhase[];
  work_intervals: WorkIntervalSummary[];
  recoveries: RecoverySummary[];
  trends: SessionTrends;
  session_classification: SessionClassification;
  /** Populated for STEADY_RUN; optional hint for other types. */
  single_effort_summary: SingleEffortSummary | null;
};

function pickNumber(obj: AnyRecord, keys: string[]) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function paceFromDistanceTime(distance_m: number | null, duration_s: number | null) {
  if (distance_m == null || duration_s == null || distance_m <= 0 || duration_s <= 0) return null;
  return duration_s / (distance_m / 1000);
}

function formatPace(secPerKm: number | null) {
  if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm <= 0) return null;
  const s = Math.round(secPerKm);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}/km`;
}

function median(nums: number[]) {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

function linearSlope(y: number[]) {
  if (y.length < 2) return null;
  const n = y.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += y[i]!;
    sumXY += i * y[i]!;
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

function mean(nums: number[]) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stdDev(nums: number[]) {
  if (nums.length < 2) return null;
  const m = mean(nums);
  if (m == null) return null;
  const v = nums.reduce((s, x) => s + (x - m) * (x - m), 0) / (nums.length - 1);
  return Math.sqrt(v);
}

function activityMovingTimeS(activity: AnyRecord | null | undefined): number | null {
  if (!activity) return null;
  const t = pickNumber(activity, ["moving_time", "elapsed_time", "moving_time_secs"]);
  return t != null && t > 0 ? t : null;
}

function pacedLapsInOrder(laps: NormalizedLap[]) {
  return laps.filter((l) => l.pace_sec_per_km != null && l.pace_sec_per_km > 0);
}

function buildSingleEffortSummary(laps: NormalizedLap[], label: string): SingleEffortSummary {
  const pl = pacedLapsInOrder(laps);
  const paces = pl.map((l) => l.pace_sec_per_km!);
  const weights = pl.map((l) => (l.distance_m != null && l.distance_m > 0 ? l.distance_m : l.duration_s ?? 1));
  let wPace = 0;
  let wDen = 0;
  for (let i = 0; i < pl.length; i++) {
    const w = weights[i]! > 0 ? weights[i]! : 1;
    wPace += paces[i]! * w;
    wDen += w;
  }
  const avgPace = wDen > 0 ? wPace / wDen : mean(paces);

  const hrs = pl.map((l) => l.avg_hr).filter((x): x is number => x != null && x > 30);
  let hrDrift: number | null = null;
  if (pl.length >= 6) {
    const third = Math.max(1, Math.floor(pl.length / 3));
    const firstHrs = pl.slice(0, third).map((l) => l.avg_hr).filter((x): x is number => x != null && x > 30);
    const lastHrs = pl.slice(-third).map((l) => l.avg_hr).filter((x): x is number => x != null && x > 30);
    const a1 = mean(firstHrs);
    const a2 = mean(lastHrs);
    if (a1 != null && a2 != null) hrDrift = a2 - a1;
  }

  const cads = pl.map((l) => l.avg_cadence).filter((x): x is number => x != null && x > 0);
  const cadMean = mean(cads);
  const cadCv = cadMean != null && cadMean > 0 && cads.length >= 2 ? (stdDev(cads) ?? 0) / cadMean : null;

  const dist = pl.reduce((s, l) => s + (l.distance_m ?? 0), 0);
  const dur = pl.reduce((s, l) => s + (l.duration_s ?? 0), 0);

  const wAvgHr = (() => {
    let n = 0;
    let d = 0;
    for (let i = 0; i < pl.length; i++) {
      const h = pl[i]!.avg_hr;
      const w = weights[i]! > 0 ? weights[i]! : 1;
      if (h != null && h > 30) {
        n += h * w;
        d += w;
      }
    }
    return d > 0 ? n / d : mean(hrs);
  })();

  return {
    label,
    avg_pace_sec_km: avgPace,
    avg_pace_per_km: formatPace(avgPace),
    weighted_avg_hr: wAvgHr,
    hr_drift_first_to_last_third_bpm: hrDrift,
    avg_cadence: cadMean,
    cadence_cv: cadCv,
    total_distance_m: dist > 0 ? dist : null,
    total_duration_s: dur > 0 ? dur : null,
  };
}

type AnalysisCore = {
  lap_count: number;
  laps: NormalizedLap[];
  phases: SessionPhase[];
  work_intervals: WorkIntervalSummary[];
  recoveries: RecoverySummary[];
  trends: SessionTrends;
};

function classifySessionType(
  laps: NormalizedLap[],
  analysis: AnalysisCore,
  activity: AnyRecord | null | undefined,
): { classification: SessionClassification; single_effort_summary: SingleEffortSummary | null } {
  const pl = pacedLapsInOrder(laps);
  const paces = pl.map((l) => l.pace_sec_per_km!);

  const defaultClassification = (): SessionClassification => ({
    session_type: "STEADY_RUN",
    rationale:
      "Insufficient lap pace data to sub-classify reliably; summarise from activity-level metrics and available laps.",
    metrics: {
      lap_pace_min_sec_km: null,
      lap_pace_max_sec_km: null,
      lap_pace_median_sec_km: null,
      lap_pace_range_sec_km: null,
      relative_pace_spread: null,
      pace_slope_sec_km_per_lap: null,
      total_moving_time_s: activityMovingTimeS(activity ?? null),
      recovery_phase_count: analysis.recoveries.length,
      work_phase_count: analysis.work_intervals.length,
      phase_count: analysis.phases.length,
    },
    ai_instructions: "",
  });

  if (paces.length === 0) {
    const classification = defaultClassification();
    classification.ai_instructions = [
      "SESSION_TYPE: STEADY_RUN (fallback — limited pace per lap).",
      "State data limitations. Summarise what is known from laps and activity totals.",
    ].join(" ");
    return {
      classification,
      single_effort_summary: buildSingleEffortSummary(laps, "Whole session"),
    };
  }

  const minP = Math.min(...paces);
  const maxP = Math.max(...paces);
  const medP = median(paces);
  const rangeP = maxP - minP;
  const relSpread = medP != null && medP > 0 ? rangeP / medP : null;
  const paceSlope = paces.length >= 3 ? linearSlope(paces) : null;

  const totalMoving = activityMovingTimeS(activity ?? null);
  const totalDurLaps = laps.reduce((s, l) => s + (l.duration_s ?? 0), 0);
  const effectiveDuration = totalMoving ?? (totalDurLaps > 0 ? totalDurLaps : null);

  const recoveryCount = analysis.recoveries.length;
  const workCount = analysis.work_intervals.length;
  const phaseCount = analysis.phases.length;

  const hasWarmupPhase = analysis.phases.some((p) => p.kind === "warm_up");
  const hasCooldownPhase = analysis.phases.some((p) => p.kind === "cool_down");
  const hasRecoveryBetweenHard = recoveryCount >= 1;
  const multiWork = workCount >= 2;

  /** Hard = fast in running terms (lower sec/km). */
  const HARD_PACE_SEC_KM = 265;
  /** Easy / jog recovery ballpark. */
  const SLOW_PACE_SEC_KM = 330;

  const fastLaps = medP != null ? paces.filter((p) => p < medP * 0.97).length : 0;
  const slowLaps = medP != null ? paces.filter((p) => p > medP * 1.06).length : 0;

  const intervalLike =
    (hasRecoveryBetweenHard && multiWork) ||
    (relSpread != null &&
      relSpread >= 0.22 &&
      minP <= HARD_PACE_SEC_KM + 40 &&
      maxP >= SLOW_PACE_SEC_KM - 20) ||
    (relSpread != null && relSpread >= 0.28) ||
    (medP != null && fastLaps >= 2 && slowLaps >= 2 && rangeP >= 45);

  const progressiveLike =
    !intervalLike &&
    paceSlope != null &&
    paceSlope < -2 &&
    paces.length >= 4 &&
    paces[0]! > paces[paces.length - 1]! + 22;

  const tightBand =
    relSpread != null && relSpread <= 0.09 && rangeP <= 32;
  const moderateBand = relSpread != null && relSpread <= 0.14 && rangeP <= 45;

  const longEffort = effectiveDuration != null && effectiveDuration >= 18 * 60;

  const tempoLike =
    !intervalLike &&
    !progressiveLike &&
    longEffort &&
    medP <= HARD_PACE_SEC_KM + 15 &&
    (tightBand || moderateBand);

  const mixedLike =
    !intervalLike &&
    hasWarmupPhase &&
    hasCooldownPhase &&
    phaseCount >= 3 &&
    (workCount >= 1 || medP <= HARD_PACE_SEC_KM + 25);

  let session_type: SessionType;
  let rationale: string;

  if (intervalLike) {
    session_type = "INTERVAL_SESSION";
    rationale =
      hasRecoveryBetweenHard && multiWork
        ? "Clear work/recovery alternation across laps (or large pace swing between fast reps and slow jogs)."
        : `Large relative pace spread between laps (~${relSpread != null ? (relSpread * 100).toFixed(0) : "?"}% of median) with distinct fast vs slow laps — typical of interval training.`;
  } else if (mixedLike) {
    session_type = "MIXED_SESSION";
    rationale =
      "Distinct warm-up, main effort block, and cool-down phases without classic rep/recovery alternation throughout the whole run.";
  } else if (progressiveLike) {
    session_type = "PROGRESSIVE_RUN";
    rationale = `Pace quickens steadily across the session (negative slope ~${paceSlope != null ? paceSlope.toFixed(1) : "?"} sec/km per lap; start slower than finish).`;
  } else if (tempoLike) {
    session_type = "TEMPO_THRESHOLD";
    rationale = `Sustained hard effort (~${effectiveDuration != null ? Math.round(effectiveDuration / 60) : "?"} min) at a tight pace band around threshold (${formatPace(medP)} median lap pace).`;
  } else if (
    phaseCount >= 3 &&
    hasWarmupPhase &&
    hasCooldownPhase &&
    workCount <= 1 &&
    !tightBand
  ) {
    session_type = "MIXED_SESSION";
    rationale =
      "Warm-up and cool-down frame a main block without repeated work/recovery reps — treat as structured mixed session.";
  } else {
    session_type = "STEADY_RUN";
    rationale = tightBand
      ? "Lap paces sit in a narrow band — consistent easy/steady aerobic effort rather than reps or strong progression."
      : "Pace variation is modest without clear interval, tempo, or progression signature; summarising as a steady continuous run.";
  }

  const aiMap: Record<SessionType, string> = {
    INTERVAL_SESSION: [
      "SESSION_TYPE: INTERVAL_SESSION.",
      "FIRST state this session type and the rationale in one short paragraph.",
      "THEN analyse rep-by-rep: each work interval vs each recovery.",
      "Show how pace, HR, cadence, and power evolved across reps.",
      "Use SESSION_INTERVAL_ANALYSIS_JSON work_intervals and recoveries as primary data.",
    ].join(" "),
    STEADY_RUN: [
      "SESSION_TYPE: STEADY_RUN.",
      "FIRST state this session type and why (narrow pace band / no rep structure).",
      "Do NOT go lap-by-lap. Summarise the whole run as ONE effort block.",
      "Cover: average pace, overall HR response and drift (use single_effort_summary if present), cadence stability (CV), and overall session quality for an easy/steady aerobic run.",
      "End with one recommendation.",
    ].join(" "),
    PROGRESSIVE_RUN: [
      "SESSION_TYPE: PROGRESSIVE_RUN.",
      "FIRST state this session type and the progression trend (pace vs time/lap order).",
      "Comment on execution: controlled vs rushed acceleration, HR response as pace increased, and whether the progression matched the intent.",
      "You may reference lap order for pace trend but do not treat as interval reps.",
    ].join(" "),
    TEMPO_THRESHOLD: [
      "SESSION_TYPE: TEMPO_THRESHOLD.",
      "FIRST state this session type — sustained threshold/tempo style block.",
      "Discuss lactate-threshold proxies: HR stability relative to pace, pacing discipline, drift late in the block, cadence and power (if present).",
      "Do NOT analyse as short reps unless data clearly shows surges.",
    ].join(" "),
    MIXED_SESSION: [
      "SESSION_TYPE: MIXED_SESSION.",
      "FIRST state this session type (e.g. warm-up + main set + cool-down, or varied blocks).",
      "Identify each phase (warm-up, main effort, cool-down, etc.) and analyse each with the appropriate lens (steady vs threshold vs easy).",
      "Then give one integrated recommendation for the whole session.",
    ].join(" "),
  };

  const classification: SessionClassification = {
    session_type,
    rationale,
    metrics: {
      lap_pace_min_sec_km: minP,
      lap_pace_max_sec_km: maxP,
      lap_pace_median_sec_km: medP,
      lap_pace_range_sec_km: rangeP,
      relative_pace_spread: relSpread,
      pace_slope_sec_km_per_lap: paceSlope,
      total_moving_time_s: effectiveDuration,
      recovery_phase_count: recoveryCount,
      work_phase_count: workCount,
      phase_count: phaseCount,
    },
    ai_instructions: aiMap[session_type],
  };

  const single_effort_summary =
    session_type === "STEADY_RUN"
      ? buildSingleEffortSummary(laps, "Whole session (steady run)")
      : session_type === "TEMPO_THRESHOLD" || session_type === "PROGRESSIVE_RUN"
        ? buildSingleEffortSummary(laps, "Main continuous block")
        : null;

  return { classification, single_effort_summary };
}

export function normalizeStreamsPayload(json: unknown): Record<string, number[]> {
  if (!json || typeof json !== "object") return {};
  const o = json as Record<string, unknown>;
  const out: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isFinite(x))) {
      out[k] = v;
      continue;
    }
    if (v && typeof v === "object" && Array.isArray((v as AnyRecord).data)) {
      const arr = (v as AnyRecord).data as unknown[];
      if (arr.every((x) => typeof x === "number" && Number.isFinite(x))) {
        out[k] = arr as number[];
      }
    }
  }
  return out;
}

function normalizeSingleLap(lap: AnyRecord, index: number, source: NormalizedLap["source"]): NormalizedLap {
  const distance_m = pickNumber(lap, [
    "distance",
    "total_distance",
    "distance_m",
    "length",
  ]);
  const duration_s = pickNumber(lap, [
    "moving_time",
    "elapsed_time",
    "moving_time_secs",
    "duration",
    "time",
  ]);
  const avg_speed = pickNumber(lap, ["average_speed", "avg_speed", "speed"]);
  let pace_sec_per_km = paceFromDistanceTime(distance_m, duration_s);
  if (pace_sec_per_km == null && avg_speed != null && avg_speed > 0) {
    pace_sec_per_km = 1000 / avg_speed;
  }
  return {
    index,
    distance_m,
    duration_s,
    pace_sec_per_km,
    avg_hr: pickNumber(lap, [
      "average_heartrate",
      "avg_heartrate",
      "average_hr",
      "avg_hr",
    ]),
    max_hr: pickNumber(lap, ["max_heartrate", "max_hr"]),
    avg_cadence: pickNumber(lap, ["average_cadence", "avg_cadence", "cadence"]),
    avg_power: pickNumber(lap, ["average_watts", "avg_watts", "weighted_average_watts"]),
    source,
  };
}

function extractDeviceLaps(activity: AnyRecord): NormalizedLap[] {
  const raw =
    activity.laps ??
    activity.lapDTOs ??
    activity.split_summaries ??
    activity.splits;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.map((lap, i) => normalizeSingleLap(lap as AnyRecord, i, "device_lap"));
}

function extractIcuIntervalLaps(activity: AnyRecord): NormalizedLap[] {
  const raw = activity.icu_intervals;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.map((iv, i) => normalizeSingleLap(iv as AnyRecord, i, "icu_interval"));
}

function insertRecoveryGapsFromIntervals(
  intervals: AnyRecord[],
  streams: Record<string, number[]>,
): NormalizedLap[] {
  if (!intervals.length) return [];

  const time = streams.time ?? streams.seconds ?? streams.elapsed_time;
  const hr = streams.heart_rate ?? streams.heartrate;

  const sorted = [...intervals].sort(
    (a, b) => (pickNumber(a as AnyRecord, ["start_time"]) ?? 0) - (pickNumber(b as AnyRecord, ["start_time"]) ?? 0),
  );

  const out: NormalizedLap[] = [];
  let lapIdx = 0;

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i] as AnyRecord;
    const prev = i > 0 ? (sorted[i - 1] as AnyRecord) : null;

    if (prev) {
      const prevEnd = pickNumber(prev, ["end_time"]);
      const curStart = pickNumber(cur, ["start_time"]);
      if (
        prevEnd != null &&
        curStart != null &&
        curStart > prevEnd + 2 &&
        time &&
        time.length > 1
      ) {
        const dt = curStart - prevEnd;
        let recoveryAvgHr: number | null = null;
        if (hr && hr.length === time.length) {
          const iStart = Math.max(0, Math.min(hr.length - 1, Math.floor(prevEnd)));
          const iEnd = Math.max(0, Math.min(hr.length, Math.ceil(curStart)));
          const mid = hr.slice(iStart, iEnd).filter((x) => x > 30);
          if (mid.length) {
            recoveryAvgHr = mid.reduce((a, b) => a + b, 0) / mid.length;
          }
        }
        out.push({
          index: lapIdx++,
          distance_m: null,
          duration_s: dt,
          pace_sec_per_km: null,
          avg_hr: recoveryAvgHr,
          max_hr: null,
          avg_cadence: null,
          avg_power: null,
          source: "recovery_gap",
        });
      }
    }

    out.push(normalizeSingleLap(cur, lapIdx++, "icu_interval"));
  }

  return out;
}

/** If we only have icu_intervals (work), merge with synthetic recovery gaps when stream time exists. */
function buildLapsFromActivityAndStreams(
  activity: AnyRecord,
  streams: Record<string, number[]>,
): NormalizedLap[] {
  const device = extractDeviceLaps(activity);
  if (device.length > 0) return device;

  const intervals = activity.icu_intervals;
  if (Array.isArray(intervals) && intervals.length > 0) {
    const withGaps = insertRecoveryGapsFromIntervals(intervals as AnyRecord[], streams);
    if (withGaps.length > 0) return withGaps;
  }

  return extractIcuIntervalLaps(activity);
}

type Intensity = "fast" | "mid" | "slow";

function classifyLapIntensity(lap: NormalizedLap, medianPace: number | null): Intensity {
  if (lap.source === "recovery_gap") return "slow";
  const pace = lap.pace_sec_per_km;
  if (pace == null || medianPace == null || medianPace <= 0) return "mid";
  const ratio = pace / medianPace;
  if (ratio < 0.94) return "fast";
  if (ratio > 1.08) return "slow";
  return "mid";
}

function workLabelFromDistance(distance_m: number | null) {
  if (distance_m == null || distance_m <= 0) return "Work block";
  const d = distance_m;
  const rounded = Math.round(d / 50) * 50;
  if (rounded >= 1000) return `${(rounded / 1000).toFixed(rounded % 1000 === 0 ? 0 : 1)}km rep`;
  return `${rounded}m rep`;
}

function aggregatePhase(laps: NormalizedLap[]) {
  const dist = laps.reduce((s, l) => s + (l.distance_m ?? 0), 0);
  const dur = laps.reduce((s, l) => s + (l.duration_s ?? 0), 0);
  const weights = laps.map((l) => l.distance_m ?? l.duration_s ?? 0);
  const wsum = weights.reduce((a, b) => a + b, 0);

  const wAvg = (getter: (l: NormalizedLap) => number | null) => {
    let num = 0;
    let den = 0;
    for (let i = 0; i < laps.length; i++) {
      const v = getter(laps[i]!);
      const w = weights[i]! > 0 ? weights[i]! : 1;
      if (v != null && Number.isFinite(v)) {
        num += v * w;
        den += w;
      }
    }
    return den > 0 ? num / den : null;
  };

  const pace = paceFromDistanceTime(dist > 0 ? dist : null, dur > 0 ? dur : null);
  return {
    distance_m: dist > 0 ? dist : null,
    duration_s: dur > 0 ? dur : null,
    pace_sec_per_km: pace,
    avg_hr: wAvg((l) => l.avg_hr),
    max_hr: (() => {
      const vals = laps.map((l) => l.max_hr).filter((x): x is number => x != null && x > 0);
      return vals.length ? Math.max(...vals) : null;
    })(),
    avg_cadence: wAvg((l) => l.avg_cadence),
    avg_power: wAvg((l) => l.avg_power),
  };
}

export function analyzeIntervalSession(
  laps: NormalizedLap[],
  activity?: AnyRecord | null,
): SessionAnalysis {
  const validPaces = laps.map((l) => l.pace_sec_per_km).filter((p): p is number => p != null && p > 0);
  const medPace = median(validPaces);

  const intensities = laps.map((l) => classifyLapIntensity(l, medPace));

  const segments: { intensity: Intensity; laps: NormalizedLap[] }[] = [];
  for (let i = 0; i < laps.length; i++) {
    const lap = laps[i]!;
    const inten = intensities[i]!;
    const last = segments[segments.length - 1];
    if (last && last.intensity === inten) last.laps.push(lap);
    else segments.push({ intensity: inten, laps: [lap] });
  }

  const phases: SessionPhase[] = [];
  let workOrdinal = 0;
  let recoveryOrdinal = 0;

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s]!;
    const agg = aggregatePhase(seg.laps);
    const idxs = seg.laps.map((l) => l.index);
    const isFirst = s === 0;
    const isLast = s === segments.length - 1;

    let kind: PhaseKind = "mixed";
    let label = "Block";

    if (seg.intensity === "fast") {
      kind = "work";
      workOrdinal += 1;
      label = workLabelFromDistance(agg.distance_m);
      if (workOrdinal > 1) label = `${label} (#${workOrdinal})`;
    } else if (seg.intensity === "slow") {
      if (isFirst) {
        kind = "warm_up";
        label = "Warm-up";
      } else if (isLast) {
        kind = "cool_down";
        label = "Cool-down";
      } else {
        kind = "recovery";
        recoveryOrdinal += 1;
        label = `Recovery ${recoveryOrdinal}`;
      }
    } else {
      kind = isFirst ? "warm_up" : isLast ? "cool_down" : "mixed";
      label = isFirst ? "Warm-up / transition" : isLast ? "Cool-down / transition" : "Transition";
    }

    phases.push({
      label,
      kind,
      lapIndices: idxs,
      distance_m: agg.distance_m,
      duration_s: agg.duration_s,
      pace_sec_per_km: agg.pace_sec_per_km,
      avg_hr: agg.avg_hr,
      max_hr: agg.max_hr && agg.max_hr > 0 ? agg.max_hr : null,
      avg_cadence: agg.avg_cadence,
      avg_power: agg.avg_power,
      hr_drop_from_prior_work_bpm: null,
    });
  }

  for (let i = 0; i < phases.length; i++) {
    const p = phases[i]!;
    if (p.kind !== "recovery") continue;
    const prevWork = [...phases.slice(0, i)].reverse().find((x) => x.kind === "work");
    if (!prevWork || prevWork.avg_hr == null || p.avg_hr == null) continue;
    p.hr_drop_from_prior_work_bpm = prevWork.avg_hr - p.avg_hr;
  }

  const work_intervals: WorkIntervalSummary[] = phases
    .filter((p) => p.kind === "work")
    .map((p) => ({
      label: p.label,
      lapIndices: p.lapIndices,
      distance_m: p.distance_m,
      pace_sec_per_km: p.pace_sec_per_km,
      pace_per_km: formatPace(p.pace_sec_per_km),
      avg_hr: p.avg_hr,
      max_hr: p.max_hr,
      avg_cadence: p.avg_cadence,
      avg_power: p.avg_power,
    }));

  const recoveries: RecoverySummary[] = phases
    .filter((p) => p.kind === "recovery")
    .map((p) => ({
      label: p.label,
      lapIndices: p.lapIndices,
      duration_s: p.duration_s,
      avg_hr: p.avg_hr,
      hr_drop_from_prior_work_bpm: p.hr_drop_from_prior_work_bpm,
    }));

  const trends = computeTrends(work_intervals);

  const core: AnalysisCore = {
    lap_count: laps.length,
    laps,
    phases,
    work_intervals,
    recoveries,
    trends,
  };

  const { classification, single_effort_summary } = classifySessionType(laps, core, activity);

  return {
    ...core,
    session_classification: classification,
    single_effort_summary,
  };
}

function computeTrends(work_intervals: WorkIntervalSummary[]): SessionTrends {
  const notes: string[] = [];
  const n = work_intervals.length;
  if (n < 2) {
    return {
      work_interval_count: n,
      pace_drift_sec_per_km_per_rep: null,
      hr_drift_bpm_per_rep: null,
      cadence_drift_per_rep: null,
      power_drift_w_per_rep: null,
      pace_degraded: null,
      hr_climbed_at_similar_pace: null,
      cadence_dropped: null,
      power_held: null,
      notes: n === 0 ? ["No distinct work intervals detected from lap pace pattern."] : ["Only one work block; trend compares need ≥2 reps."],
    };
  }

  const paces = work_intervals.map((w) => w.pace_sec_per_km).filter((x): x is number => x != null && x > 0);
  const hrs = work_intervals.map((w) => w.avg_hr).filter((x): x is number => x != null);
  const cads = work_intervals.map((w) => w.avg_cadence).filter((x): x is number => x != null);
  const pws = work_intervals.map((w) => w.avg_power).filter((x): x is number => x != null);

  const paceSlope = paces.length >= 2 ? linearSlope(paces) : null;
  const hrSlope = hrs.length >= 2 ? linearSlope(hrs) : null;
  const cadSlope = cads.length >= 2 ? linearSlope(cads) : null;
  const powSlope = pws.length >= 2 ? linearSlope(pws) : null;

  const pace_degraded = paceSlope != null ? paceSlope > 0.35 : null;
  const hr_climbed_at_similar_pace =
    hrSlope != null && paceSlope != null ? hrSlope > 0.4 && Math.abs(paceSlope) < 0.6 : null;
  const cadence_dropped = cadSlope != null ? cadSlope < -0.25 : null;
  const power_held = powSlope != null ? Math.abs(powSlope) < 1.5 : pws.length >= 2 ? true : null;

  if (pace_degraded) notes.push("Pace tended to slow across hard intervals (positive pace drift in sec/km).");
  if (hr_climbed_at_similar_pace) notes.push("HR crept up with relatively stable pacing — common fatigue or dehydration signal.");
  if (cadence_dropped) notes.push("Cadence drifted down across reps — check leg stiffness / neuromuscular fatigue.");
  if (power_held === true && pws.length >= 2) notes.push("Power stayed relatively steady across work bouts.");

  return {
    work_interval_count: n,
    pace_drift_sec_per_km_per_rep: paceSlope,
    hr_drift_bpm_per_rep: hrSlope,
    cadence_drift_per_rep: cadSlope,
    power_drift_w_per_rep: powSlope,
    pace_degraded,
    hr_climbed_at_similar_pace,
    cadence_dropped,
    power_held,
    notes,
  };
}

export function buildSessionAnalysisFromActivity(
  activity: unknown,
  streamsJson: unknown,
): SessionAnalysis | { error: string } {
  if (!activity || typeof activity !== "object") {
    return { error: "Invalid activity payload" };
  }
  const act = activity as AnyRecord;
  const streams = normalizeStreamsPayload(streamsJson);

  let laps = buildLapsFromActivityAndStreams(act, streams);

  if (laps.length === 0) {
    return {
      error:
        "No laps or intervals found on this activity. Ensure the file had auto-laps or Intervals detected intervals; try an interval/tempo session with lap splits.",
    };
  }

  return analyzeIntervalSession(laps, act);
}
