"use client";

import { useEffect, useState } from "react";

type AnyRecord = Record<string, unknown>;

type ApiResponse = {
  activities: unknown;
  wellness: unknown;
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

function formatInt(n: number | null) {
  if (n == null) return "—";
  return String(Math.round(n));
}

function formatActivityDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr.substring(0, 10) + "T12:00:00Z");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

type ActivityTypeCls = "run" | "ride" | "strength" | "other";

function resolveActivityType(typeStr: string | null): {
  label: string;
  cls: ActivityTypeCls;
} {
  if (!typeStr) return { label: "—", cls: "other" };
  const t = typeStr.toLowerCase();
  if (t.includes("run") || t === "running") return { label: "Run", cls: "run" };
  if (
    t.includes("ride") ||
    t.includes("cycl") ||
    t.includes("bike") ||
    t === "virtualride"
  )
    return { label: "Ride", cls: "ride" };
  if (
    t.includes("strength") ||
    t.includes("weight") ||
    t.includes("gym") ||
    t.includes("workout")
  )
    return { label: "Strength", cls: "strength" };
  return { label: typeStr, cls: "other" };
}

export function TrainingClient() {
  const [activities, setActivities] = useState<AnyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/intervals/recent?days=30&limit=30", {
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
        if (!cancelled) setActivities(asArray(json.activities));
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load activities");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="stack">
      {loading ? (
        <div className="card stack">
          <div style={{ fontWeight: 500 }}>Loading…</div>
          <div className="muted">Fetching activities from Intervals.icu.</div>
        </div>
      ) : error ? (
        <div className="card stack">
          <div style={{ fontWeight: 500 }}>Couldn&apos;t load activities</div>
          <div className="error">{error}</div>
        </div>
      ) : (
        <div className="card stack">
          <p className="sectionTitle">Recent Activities</p>

          {activities.length === 0 ? (
            <div className="muted">No activities returned.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Date</th>
                    <th className="num">Distance</th>
                    <th className="num">Duration</th>
                    <th className="num">Avg HR</th>
                  </tr>
                </thead>
                <tbody>
                  {activities.slice(0, 20).map((a, idx) => {
                    const name =
                      pickString(a, ["name", "title"]) ?? "Untitled";
                    const rawDate =
                      pickString(a, [
                        "start_date_local",
                        "start_date",
                        "date",
                      ]) ?? null;
                    const typeStr = pickString(a, [
                      "type",
                      "sport",
                      "sport_type",
                      "workout_type",
                      "activity_type",
                    ]);
                    const { label: typeLabel, cls: typeCls } =
                      resolveActivityType(typeStr);
                    const distance = pickNumber(a, [
                      "distance",
                      "distance_m",
                      "dist",
                    ]);
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
                        <td style={{ minWidth: 90 }}>
                          <span className={`typePill ${typeCls}`}>
                            {typeLabel}
                          </span>
                        </td>
                        <td
                          style={{
                            minWidth: 100,
                            color: "var(--text-secondary)",
                          }}
                        >
                          {formatActivityDate(rawDate)}
                        </td>
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
      )}
    </section>
  );
}
