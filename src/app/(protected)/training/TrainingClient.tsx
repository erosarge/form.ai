"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

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

function formatPace(decimalMin: number): string {
  const min = Math.floor(decimalMin);
  const sec = Math.round((decimalMin - min) * 60);
  return `${min}:${String(sec).padStart(2, "0")}`;
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

const TYPE_COLORS: Record<ActivityTypeCls, string> = {
  run: "#a3c45a",
  ride: "#5b9fd4",
  strength: "#d4a017",
  other: "#3d3d3d",
};

type ChartPoint = {
  date: string;
  dateSort: string;
  name: string;
  distKm: number;
  paceDecimal: number | null;
  typeCls: ActivityTypeCls;
  typeLabel: string;
};

function ChartTooltipContent({ active, payload }: { active?: boolean; payload?: { payload: ChartPoint }[] }) {
  if (!active || !payload?.length) return null;
  const d: ChartPoint = payload[0]?.payload;
  if (!d) return null;
  return (
    <div
      style={{
        background: "#1a1a1a",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <div style={{ fontWeight: 600, color: "#f2f0eb", marginBottom: 4 }}>
        {d.name}
      </div>
      <div style={{ color: "#6b6b6b" }}>{d.date}</div>
      <div style={{ color: TYPE_COLORS[d.typeCls], marginTop: 2 }}>
        {d.typeLabel}
      </div>
      {d.distKm > 0 && (
        <div style={{ color: "#f2f0eb", marginTop: 4 }}>
          {d.distKm.toFixed(1)} km
        </div>
      )}
      {d.paceDecimal != null && (
        <div style={{ color: "#a3c45a" }}>{formatPace(d.paceDecimal)} /km</div>
      )}
    </div>
  );
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

  const chartData = useMemo<ChartPoint[]>(() => {
    return [...activities]
      .sort((a, b) => {
        const da = pickString(a, ["start_date_local", "start_date", "date"]) ?? "";
        const db = pickString(b, ["start_date_local", "start_date", "date"]) ?? "";
        return da.localeCompare(db);
      })
      .map((a) => {
        const rawDate =
          pickString(a, ["start_date_local", "start_date", "date"]) ?? "";
        const typeStr = pickString(a, [
          "type",
          "sport",
          "sport_type",
          "workout_type",
          "activity_type",
        ]);
        const { label: typeLabel, cls: typeCls } = resolveActivityType(typeStr);
        const distanceM = pickNumber(a, ["distance", "distance_m", "dist"]) ?? 0;
        const distKm = distanceM / 1000;
        const movingTime = pickNumber(a, [
          "moving_time",
          "elapsed_time",
          "duration",
          "seconds",
        ]);

        let paceDecimal: number | null = null;
        if (typeCls === "run" && movingTime != null && distKm > 0.1) {
          paceDecimal = movingTime / 60 / distKm;
          // Sanity: discard pace outside 2–20 min/km
          if (paceDecimal < 2 || paceDecimal > 20) paceDecimal = null;
        }

        return {
          date: formatActivityDate(rawDate || null),
          dateSort: rawDate.slice(0, 10),
          name: pickString(a, ["name", "title"]) ?? "Untitled",
          distKm: Math.round(distKm * 10) / 10,
          paceDecimal,
          typeCls,
          typeLabel,
        };
      })
      .filter((d) => d.distKm > 0 || d.typeCls === "strength");
  }, [activities]);

  const hasPaceData = chartData.some((d) => d.paceDecimal != null);

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
        <>
          {/* ── Trend Chart ────────────────────────────────── */}
          {chartData.length > 0 && (
            <div className="card stack">
              <p className="sectionTitle">30-Day Training Trends</p>
              <div style={{ width: "100%", height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 4, right: hasPaceData ? 40 : 8, left: -16, bottom: 0 }}
                  >
                    <CartesianGrid
                      vertical={false}
                      stroke="rgba(255,255,255,0.04)"
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "#3d3d3d", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      yAxisId="dist"
                      orientation="left"
                      tick={{ fill: "#3d3d3d", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => `${v}k`}
                      width={36}
                    />
                    {hasPaceData && (
                      <YAxis
                        yAxisId="pace"
                        orientation="right"
                        tick={{ fill: "#3d3d3d", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        reversed
                        tickFormatter={(v: number) => formatPace(v)}
                        width={40}
                        domain={["dataMin - 0.5", "dataMax + 0.5"]}
                      />
                    )}
                    <Tooltip content={<ChartTooltipContent />} />
                    <Bar
                      yAxisId="dist"
                      dataKey="distKm"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={20}
                    >
                      {chartData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={TYPE_COLORS[entry.typeCls]}
                          opacity={0.85}
                        />
                      ))}
                    </Bar>
                    {hasPaceData && (
                      <Line
                        yAxisId="pace"
                        dataKey="paceDecimal"
                        stroke="#a3c45a"
                        strokeWidth={1.5}
                        dot={{ r: 3, fill: "#a3c45a", strokeWidth: 0 }}
                        activeDot={{ r: 5, fill: "#a3c45a", strokeWidth: 0 }}
                        connectNulls={false}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {/* Legend */}
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  flexWrap: "wrap",
                  marginTop: -8,
                }}
              >
                {(
                  [
                    ["run", "Run"],
                    ["ride", "Ride"],
                    ["strength", "Strength"],
                  ] as [ActivityTypeCls, string][]
                )
                  .filter(([cls]) =>
                    chartData.some((d) => d.typeCls === cls),
                  )
                  .map(([cls, label]) => (
                    <div
                      key={cls}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 10,
                        color: "#6b6b6b",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          background: TYPE_COLORS[cls],
                        }}
                      />
                      {label}
                    </div>
                  ))}
                {hasPaceData && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 10,
                      color: "#6b6b6b",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 2,
                        background: "#a3c45a",
                        borderRadius: 1,
                      }}
                    />
                    Pace (right axis)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Activities Table ─────────────────────────── */}
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
        </>
      )}
    </section>
  );
}
