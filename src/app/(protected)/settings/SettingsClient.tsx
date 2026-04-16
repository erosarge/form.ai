"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";
import { useRouter } from "next/navigation";

type Settings = {
  athlete_name: string;
  height_cm: string;
  weight_kg: string;
  goal_5k: string;
  goal_10k: string;
  goal_half_marathon: string;
  goal_marathon: string;
  other_goals: string;
};

const DEFAULTS: Settings = {
  athlete_name: "",
  height_cm: "",
  weight_kg: "",
  goal_5k: "Sub 17 min",
  goal_10k: "",
  goal_half_marathon: "Sub 80 min",
  goal_marathon: "",
  other_goals: "",
};

export function SettingsClient({ userEmail }: { userEmail?: string }) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [athleteNameHint, setAthleteNameHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">(
    "idle",
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [signOutBusy, setSignOutBusy] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [settingsRes, athleteRes] = await Promise.all([
          fetch("/api/settings"),
          fetch("/api/intervals/athlete"),
        ]);

        const savedSettings = settingsRes.ok ? await settingsRes.json() : null;
        const athleteData = athleteRes.ok ? await athleteRes.json() : null;

        const sourceName: string | null = athleteData?.name ?? null;
        if (sourceName) setAthleteNameHint(sourceName);

        if (savedSettings) {
          setSettings({
            athlete_name:
              savedSettings.athlete_name ?? sourceName ?? "",
            height_cm:
              savedSettings.height_cm != null
                ? String(savedSettings.height_cm)
                : "",
            weight_kg:
              savedSettings.weight_kg != null
                ? String(savedSettings.weight_kg)
                : "",
            goal_5k: savedSettings.goal_5k ?? DEFAULTS.goal_5k,
            goal_10k: savedSettings.goal_10k ?? "",
            goal_half_marathon:
              savedSettings.goal_half_marathon ?? DEFAULTS.goal_half_marathon,
            goal_marathon: savedSettings.goal_marathon ?? "",
            other_goals: savedSettings.other_goals ?? "",
          });
        } else if (sourceName) {
          setSettings((prev) => ({ ...prev, athlete_name: sourceName }));
        }
      } catch {
        /* proceed with defaults */
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveStatus("idle");
    setSaveError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          athlete_name: settings.athlete_name || null,
          height_cm: settings.height_cm ? Number(settings.height_cm) : null,
          weight_kg: settings.weight_kg ? Number(settings.weight_kg) : null,
          goal_5k: settings.goal_5k || null,
          goal_10k: settings.goal_10k || null,
          goal_half_marathon: settings.goal_half_marathon || null,
          goal_marathon: settings.goal_marathon || null,
          other_goals: settings.other_goals || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg = body?.error ?? "Failed to save";
        console.error("[settings] save failed — HTTP", res.status, body);
        throw new Error(msg);
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err) {
      console.error("[settings] save failed:", err);
      setSaveStatus("error");
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    setSignOutBusy(true);
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/");
  }

  function update(key: keyof Settings) {
    return (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      setSettings((prev) => ({ ...prev, [key]: e.target.value }));
      setSaveStatus("idle");
    };
  }

  if (loading) {
    return (
      <div className="card">
        <div className="muted">Loading settings…</div>
      </div>
    );
  }

  return (
    <div className="stack">
      {/* ── Personal Info ─────────────────────────────────── */}
      <div className="card stack">
        <p className="sectionTitle">Personal Info</p>
        {userEmail && (
          <div className="muted" style={{ fontSize: 13 }}>
            {userEmail}
          </div>
        )}
        <div className="settingsFields">
          <label className="settingsLabel">
            <span>Athlete Name</span>
            <input
              className="input"
              type="text"
              value={settings.athlete_name}
              onChange={update("athlete_name")}
              placeholder={athleteNameHint ?? "Your name"}
            />
          </label>
          <div className="settingsRow">
            <label className="settingsLabel">
              <span>Height</span>
              <div className="inputWithUnit">
                <input
                  className="input"
                  type="number"
                  value={settings.height_cm}
                  onChange={update("height_cm")}
                  placeholder="175"
                  min="100"
                  max="250"
                />
                <span className="inputUnit">cm</span>
              </div>
            </label>
            <label className="settingsLabel">
              <span>Weight</span>
              <div className="inputWithUnit">
                <input
                  className="input"
                  type="number"
                  value={settings.weight_kg}
                  onChange={update("weight_kg")}
                  placeholder="70"
                  min="30"
                  max="200"
                />
                <span className="inputUnit">kg</span>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* ── Race Goals ────────────────────────────────────── */}
      <div className="card stack">
        <p className="sectionTitle">Race Goals</p>
        <div className="settingsFields">
          <div className="settingsRow">
            <label className="settingsLabel">
              <span>5K Target</span>
              <input
                className="input"
                type="text"
                value={settings.goal_5k}
                onChange={update("goal_5k")}
                placeholder="e.g. Sub 17 min"
              />
            </label>
            <label className="settingsLabel">
              <span>10K Target</span>
              <input
                className="input"
                type="text"
                value={settings.goal_10k}
                onChange={update("goal_10k")}
                placeholder="e.g. Sub 35 min"
              />
            </label>
          </div>
          <div className="settingsRow">
            <label className="settingsLabel">
              <span>Half Marathon Target</span>
              <input
                className="input"
                type="text"
                value={settings.goal_half_marathon}
                onChange={update("goal_half_marathon")}
                placeholder="e.g. Sub 80 min"
              />
            </label>
            <label className="settingsLabel">
              <span>Marathon Target</span>
              <input
                className="input"
                type="text"
                value={settings.goal_marathon}
                onChange={update("goal_marathon")}
                placeholder="e.g. Sub 3h"
              />
            </label>
          </div>
          <label className="settingsLabel">
            <span>Other Goals</span>
            <textarea
              className="textarea"
              value={settings.other_goals}
              onChange={update("other_goals")}
              placeholder="Any other goals, notes, or targets…"
              rows={3}
            />
          </label>
        </div>
      </div>

      {/* ── Save ─────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          className="button"
          onClick={handleSave}
          disabled={saving}
          style={{ flex: 1 }}
        >
          {saving ? "Saving…" : "Save Settings"}
        </button>
        {saveStatus === "saved" && (
          <span className="success" style={{ fontSize: 13 }}>
            Saved
          </span>
        )}
        {saveStatus === "error" && (
          <span className="error" style={{ fontSize: 13 }}>
            {saveError ?? "Failed to save"}
          </span>
        )}
      </div>

      {/* ── Sign Out ─────────────────────────────────────── */}
      <button
        className="button"
        onClick={handleSignOut}
        disabled={signOutBusy}
        style={{ background: "var(--danger)", color: "#fff", width: "100%" }}
      >
        {signOutBusy ? "Signing out…" : "Sign Out"}
      </button>
    </div>
  );
}
