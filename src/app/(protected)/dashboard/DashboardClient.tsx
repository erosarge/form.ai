"use client";

import { useEffect, useMemo, useState } from "react";

type AnyRecord = Record<string, unknown>;

type ApiResponse = {
  activities: unknown;
  wellness: unknown;
  meta?: { oldest?: string; newest?: string; athleteId?: string };
};

type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  ts: number;
};

function asArray(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? (value as AnyRecord[]) : [];
}

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

function pickString(obj: AnyRecord, keys: string[]) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function formatDistanceMeters(meters: number | null) {
  if (meters == null) return "—";
  const km = meters / 1000;
  return `${km.toFixed(km >= 100 ? 0 : 1)} km`;
}

function formatSeconds(seconds: number | null) {
  if (seconds == null) return "—";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatSleepHmm(seconds: number | null) {
  if (seconds == null) return "—";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function formatOneDecimal(n: number | null) {
  if (n == null) return "—";
  return n.toFixed(1);
}

function formatInt(n: number | null) {
  if (n == null) return "—";
  return String(Math.round(n));
}

type TrainingStatusKey = "fresh" | "optimal" | "productive" | "overreaching";
type TrainingStatus = {
  label: string;
  description: string;
  key: TrainingStatusKey;
};

function deriveTrainingStatus(form: number | null): TrainingStatus | null {
  if (form == null) return null;
  if (form > 5)
    return {
      label: "Fresh",
      key: "fresh",
      description: "Your body is recovered and ready to perform.",
    };
  if (form >= -10)
    return {
      label: "Optimal",
      key: "optimal",
      description: "Good balance of fitness and fatigue.",
    };
  if (form >= -20)
    return {
      label: "Productive",
      key: "productive",
      description: "Building fitness — fatigue is manageable.",
    };
  return {
    label: "Overreaching",
    key: "overreaching",
    description: "High load — prioritise recovery and easy days.",
  };
}

type HrvStatusKey = "balanced" | "elevated" | "suppressed";

function deriveHrv7DayStatus(
  hrv7Avg: number | null,
  baseline: number | null,
): HrvStatusKey | null {
  if (hrv7Avg == null || baseline == null || baseline === 0) return null;
  const ratio = hrv7Avg / baseline;
  if (ratio > 1.05) return "elevated";
  if (ratio < 0.95) return "suppressed";
  return "balanced";
}

const TRAINING_STATUS_COLORS: Record<TrainingStatusKey, string> = {
  fresh: "#059669",
  optimal: "#2563eb",
  productive: "#d97706",
  overreaching: "#dc2626",
};

const HRV_STATUS_COLORS: Record<HrvStatusKey, string> = {
  balanced: "#059669",
  elevated: "#d97706",
  suppressed: "#dc2626",
};

const HRV_STATUS_LABELS: Record<HrvStatusKey, string> = {
  balanced: "Balanced",
  elevated: "Elevated",
  suppressed: "Suppressed",
};

export function DashboardClient() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [chat, setChat] = useState<ChatTurn[]>([
    {
      role: "assistant",
      content: "How can I help you with your training today?",
      ts: Date.now(),
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/intervals/recent?days=14&limit=20", {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          const msg =
            body && typeof body === "object" && "error" in body
              ? String((body as AnyRecord).error)
              : `Request failed (${res.status})`;
          throw new Error(msg);
        }
        const json = (await res.json()) as ApiResponse;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load dashboard data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const activities = useMemo(() => asArray(data?.activities), [data]);
  const wellnessRows = useMemo(() => asArray(data?.wellness), [data]);
  const wellness = useMemo(() => wellnessRows[0] ?? null, [wellnessRows]);

  const wellnessKpis = useMemo(() => {
    if (!wellness) return null;

    const date = pickString(wellness, ["id", "date", "start_date_local"]);
    const restingHr = pickNumber(wellness, ["restingHR", "resting_hr", "restingHr"]);
    const hrvLastNight = pickNumber(wellness, ["hrv", "hrvNightAvg", "hrv_night_avg"]);
    const sleepScore = pickNumber(wellness, ["sleepScore", "sleep_score"]);
    const sleepSecs = pickNumber(wellness, ["sleepSecs", "sleep_secs", "sleepSeconds"]);
    const vo2max = pickNumber(wellness, ["vo2max", "vo2Max", "VO2max"]);
    const form = pickNumber(wellness, ["form", "tsb", "icu_form"]);

    const trainingStatus = deriveTrainingStatus(form);

    // HRV 7-day average from most-recent 7 rows with a valid HRV value
    const recentHrvValues = wellnessRows
      .slice(0, 7)
      .map((r) => pickNumber(r, ["hrv", "hrvNightAvg", "hrv_night_avg"]))
      .filter((v): v is number => v !== null);

    const hrv7DayAvg =
      recentHrvValues.length > 0
        ? recentHrvValues.reduce((a, b) => a + b, 0) / recentHrvValues.length
        : null;

    // Baseline from full window for deviation comparison
    const allHrvValues = wellnessRows
      .map((r) => pickNumber(r, ["hrv", "hrvNightAvg", "hrv_night_avg"]))
      .filter((v): v is number => v !== null);
    const baselineHrv =
      allHrvValues.length > 0
        ? allHrvValues.reduce((a, b) => a + b, 0) / allHrvValues.length
        : null;

    const hrv7DayStatus = deriveHrv7DayStatus(hrv7DayAvg, baselineHrv);

    return {
      date,
      restingHr,
      hrvLastNight,
      hrv7DayAvg,
      hrv7DayStatus,
      sleepScore,
      sleepSecs,
      vo2max,
      trainingStatus,
    };
  }, [wellness, wellnessRows]);

  async function sendChatMessage() {
    const text = chatInput.trim();
    if (!text || chatBusy) return;

    setChatError(null);
    setChatInput("");
    setChatBusy(true);

    const userTurn: ChatTurn = { role: "user", content: text, ts: Date.now() };
    const assistantTurn: ChatTurn = { role: "assistant", content: "", ts: Date.now() + 1 };

    setChat((prev) => [...prev, userTurn, assistantTurn]);

    try {
      const historyForApi = chat
        .filter((t) => t.role === "user" || t.role === "assistant")
        .slice(-10)
        .map((t) => ({ role: t.role, content: t.content }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, history: historyForApi }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        const msg =
          body && typeof body === "object" && "error" in body
            ? String((body as AnyRecord).error)
            : `Chat request failed (${res.status})`;
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const snapshot = acc;
        setChat((prev) => {
          const next = prev.slice();
          const last = next[next.length - 1];
          if (!last || last.role !== "assistant") return prev;
          next[next.length - 1] = { ...last, content: snapshot };
          return next;
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chat failed";
      setChatError(msg);
      setChat((prev) => {
        const next = prev.slice();
        const last = next[next.length - 1];
        if (!last || last.role !== "assistant") return prev;
        next[next.length - 1] = {
          ...last,
          content: last.content || `[error] ${msg}`,
        };
        return next;
      });
    } finally {
      setChatBusy(false);
    }
  }

  return (
    <section className="stack">
      <div className="row wrap space-between">
        <div className="pill">
          <span className="muted">Range</span>
          <span>
            {data?.meta?.oldest ?? "—"} → {data?.meta?.newest ?? "—"}
          </span>
        </div>
        <button className="button" onClick={() => window.location.reload()}>
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="card stack">
          <div style={{ fontWeight: 650 }}>Loading…</div>
          <div className="muted">Fetching activities and wellness from Intervals.icu.</div>
        </div>
      ) : error ? (
        <div className="card stack">
          <div style={{ fontWeight: 650 }}>Couldn't load dashboard</div>
          <div className="error">{error}</div>
          <div className="muted">
            Check <code>INTERVALS_ICU_API_KEY</code> and <code>INTERVALS_ICU_ATHLETE_ID</code> in{" "}
            <code>.env.local</code>.
          </div>
        </div>
      ) : (
        <>
          {/* Wellness */}
          <div className="card stack">
            <div className="row space-between">
              <h2 style={{ margin: 0, fontSize: 18 }}>Wellness</h2>
              <div className="muted" style={{ fontSize: 12 }}>
                {wellnessKpis?.date ?? "—"}
              </div>
            </div>

            <div className="kpiGrid">
              {/* Resting HR */}
              <div className="kpi">
                <div className="kpiLabel">Resting HR</div>
                <div className="kpiValue">
                  {formatInt(wellnessKpis?.restingHr ?? null)}
                </div>
                <div className="kpiSub">bpm</div>
              </div>

              {/* HRV Last Night */}
              <div className="kpi">
                <div className="kpiLabel">HRV Last Night</div>
                <div className="kpiValue">
                  {formatOneDecimal(wellnessKpis?.hrvLastNight ?? null)}
                </div>
                <div className="kpiSub">ms</div>
              </div>

              {/* HRV 7-Day */}
              <div className="kpi">
                <div className="kpiLabel">HRV 7-Day</div>
                <div className="kpiValue">
                  {formatOneDecimal(wellnessKpis?.hrv7DayAvg ?? null)}
                </div>
                {wellnessKpis?.hrv7DayStatus ? (
                  <div
                    className="kpiStatus"
                    style={{ color: HRV_STATUS_COLORS[wellnessKpis.hrv7DayStatus] }}
                  >
                    {HRV_STATUS_LABELS[wellnessKpis.hrv7DayStatus]}
                  </div>
                ) : (
                  <div className="kpiSub">ms avg</div>
                )}
              </div>

              {/* Sleep Score */}
              <div className="kpi">
                <div className="kpiLabel">Sleep Score</div>
                <div className="kpiValue">
                  {formatInt(wellnessKpis?.sleepScore ?? null)}
                </div>
                <div className="kpiSub">/ 100</div>
              </div>

              {/* Sleep Duration */}
              <div className="kpi">
                <div className="kpiLabel">Sleep Duration</div>
                <div className="kpiValue">
                  {formatSleepHmm(wellnessKpis?.sleepSecs ?? null)}
                </div>
                <div className="kpiSub">h:mm</div>
              </div>

              {/* VO₂ Max */}
              <div className="kpi">
                <div className="kpiLabel">VO₂ Max</div>
                <div className="kpiValue">
                  {formatOneDecimal(wellnessKpis?.vo2max ?? null)}
                </div>
                <div className="kpiSub">mL/kg/min</div>
              </div>

              {/* Training Status — full width */}
              <div className="kpi kpiTraining">
                <div className="kpiLabel">Training Status</div>
                {wellnessKpis?.trainingStatus ? (
                  <>
                    <div
                      className="kpiValue"
                      style={{
                        color: TRAINING_STATUS_COLORS[wellnessKpis.trainingStatus.key],
                      }}
                    >
                      {wellnessKpis.trainingStatus.label}
                    </div>
                    <div className="kpiSub">{wellnessKpis.trainingStatus.description}</div>
                  </>
                ) : (
                  <div className="kpiValue">—</div>
                )}
              </div>
            </div>
          </div>

          {/* Chat */}
          <div className="card chatWrap">
            <div className="row space-between">
              <h2 style={{ margin: 0, fontSize: 18 }}>Chat</h2>
              <span className="pill">{chatBusy ? "Thinking…" : "Ready"}</span>
            </div>

            <div className="chatLog" aria-live="polite">
              <div className="stack" style={{ gap: 10 }}>
                {chat.map((t, i) => (
                  <div key={`${t.ts}-${i}`} className={`chatMsg ${t.role}`}>
                    <div className="chatMeta">{t.role === "user" ? "You" : "Coach"}</div>
                    <div className="chatText">{t.content}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="chatInputRow">
              <textarea
                className="textarea"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="e.g. How was the structure of my last interval session?"
                disabled={chatBusy}
              />
              <button className="button" onClick={sendChatMessage} disabled={chatBusy}>
                Send
              </button>
            </div>

            {chatError ? <div className="error">{chatError}</div> : null}
          </div>

          {/* Recent Activities */}
          <div className="card stack">
            <h2 style={{ margin: 0, fontSize: 18 }}>Recent activities</h2>

            {activities.length === 0 ? (
              <div className="muted">No activities returned.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Date</th>
                      <th className="num">Distance</th>
                      <th className="num">Duration</th>
                      <th className="num">Avg HR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activities.slice(0, 20).map((a, idx) => {
                      const name = pickString(a, ["name", "title"]) ?? "Untitled";
                      const date =
                        pickString(a, ["start_date_local", "start_date", "date"]) ?? "—";
                      const distance = pickNumber(a, ["distance", "distance_m", "dist"]);
                      const duration = pickNumber(a, [
                        "moving_time",
                        "elapsed_time",
                        "duration",
                        "seconds",
                      ]);
                      const avgHr = pickNumber(a, [
                        "average_heartrate",
                        "avg_heartrate",
                        "avg_hr",
                        "average_hr",
                      ]);

                      return (
                        <tr key={pickString(a, ["id"]) ?? String(idx)}>
                          <td style={{ minWidth: 160 }}>{name}</td>
                          <td style={{ minWidth: 110 }}>{date}</td>
                          <td className="num" style={{ minWidth: 90 }}>
                            {formatDistanceMeters(distance)}
                          </td>
                          <td className="num" style={{ minWidth: 90 }}>
                            {formatSeconds(duration)}
                          </td>
                          <td className="num" style={{ minWidth: 70 }}>
                            {formatInt(avgHr)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
