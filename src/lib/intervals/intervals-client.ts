import "server-only";

import { getIntervalsEnv } from "./env";

function basicAuthHeader(apiKey: string) {
  // Per Intervals.icu docs: username is literal "API_KEY", password is your API key.
  const token = Buffer.from(`API_KEY:${apiKey}`).toString("base64");
  return `Basic ${token}`;
}

function isoDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

export type IntervalsRecentData = {
  activities: unknown;
  wellness: unknown;
  meta: {
    oldest: string;
    newest: string;
    athleteId: string;
  };
};

export async function fetchIntervalsAthleteProfile(): Promise<unknown> {
  const { apiKey, athleteId } = getIntervalsEnv();

  const headers = {
    Authorization: basicAuthHeader(apiKey),
    Accept: "application/json",
  } as const;

  const url = `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}`;
  const res = await fetch(url, { headers, cache: "no-store" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Intervals athlete fetch failed (${res.status}): ${text || res.statusText}`,
    );
  }

  return res.json();
}

export async function fetchIntervalsActivityDetail(
  activityId: string | number,
  { intervals = true }: { intervals?: boolean } = {},
): Promise<unknown> {
  const { apiKey } = getIntervalsEnv();

  const headers = {
    Authorization: basicAuthHeader(apiKey),
    Accept: "application/json",
  } as const;

  const url = new URL(
    `https://intervals.icu/api/v1/activity/${encodeURIComponent(String(activityId))}`,
  );
  if (intervals) url.searchParams.set("intervals", "true");

  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Intervals activity fetch failed (${res.status}): ${text || res.statusText}`,
    );
  }
  return res.json();
}

export async function fetchIntervalsActivityStreams(
  activityId: string | number,
  types = "time,distance,watts,heart_rate,cadence,velocity_smooth",
): Promise<unknown> {
  const { apiKey } = getIntervalsEnv();

  const headers = {
    Authorization: basicAuthHeader(apiKey),
    Accept: "application/json",
  } as const;

  const url = new URL(
    `https://intervals.icu/api/v1/activity/${encodeURIComponent(String(activityId))}/streams.json`,
  );
  if (types) url.searchParams.set("types", types);

  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Intervals streams fetch failed (${res.status}): ${text || res.statusText}`,
    );
  }
  return res.json();
}

export async function fetchIntervalsRecent({
  days = 14,
  limit = 20,
}: {
  days?: number;
  limit?: number;
}): Promise<IntervalsRecentData> {
  const { apiKey, athleteId } = getIntervalsEnv();

  const newestDate = new Date();
  const oldestDate = new Date();
  oldestDate.setDate(newestDate.getDate() - Math.max(1, days));

  const newest = isoDateOnly(newestDate);
  const oldest = isoDateOnly(oldestDate);

  const headers = {
    Authorization: basicAuthHeader(apiKey),
    Accept: "application/json",
  } as const;

  const base = `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}`;

  const activitiesUrl = new URL(`${base}/activities`);
  activitiesUrl.searchParams.set("oldest", oldest);
  activitiesUrl.searchParams.set("newest", newest);
  activitiesUrl.searchParams.set("limit", String(limit));

  const wellnessUrl = new URL(`${base}/wellness`);
  wellnessUrl.searchParams.set("oldest", oldest);
  wellnessUrl.searchParams.set("newest", newest);

  const [activitiesRes, wellnessRes] = await Promise.all([
    fetch(activitiesUrl, { headers, cache: "no-store" }),
    fetch(wellnessUrl, { headers, cache: "no-store" }),
  ]);

  if (!activitiesRes.ok) {
    const text = await activitiesRes.text().catch(() => "");
    throw new Error(
      `Intervals activities fetch failed (${activitiesRes.status}): ${text || activitiesRes.statusText}`,
    );
  }

  if (!wellnessRes.ok) {
    const text = await wellnessRes.text().catch(() => "");
    throw new Error(
      `Intervals wellness fetch failed (${wellnessRes.status}): ${text || wellnessRes.statusText}`,
    );
  }

  const [activities, wellness] = await Promise.all([
    activitiesRes.json(),
    wellnessRes.json(),
  ]);

  return {
    activities,
    wellness,
    meta: { oldest, newest, athleteId },
  };
}

