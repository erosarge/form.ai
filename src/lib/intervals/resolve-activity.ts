import "server-only";

type AnyRecord = Record<string, unknown>;

function pickString(obj: AnyRecord, keys: string[]) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

/** Sort activities newest-first by start date string. */
export function sortActivitiesNewestFirst(activities: unknown): AnyRecord[] {
  const list = Array.isArray(activities) ? (activities as AnyRecord[]) : [];
  return [...list].sort((a, b) => {
    const da = pickString(a, ["start_date_local", "start_date", "date"]) ?? "";
    const db = pickString(b, ["start_date_local", "start_date", "date"]) ?? "";
    return db.localeCompare(da);
  });
}

export function wantsSessionDeepDive(message: string): boolean {
  const m = message.toLowerCase();
  if (m.length < 2) return false;
  return (
    /\b(interval|intervals|lap|laps|rep|reps|split|splits|workout|session|tempo|threshold|track|strides|fartlek)\b/.test(
      m,
    ) ||
    /\b(analyze|analyse|break\s*down|structure|quality|fatigue)\b/.test(m) ||
    /\b(400m|800m|200m|1000m|1k|5x|6x|8x|10x)\b/.test(m)
  );
}

export function resolveActivityIdForChat({
  message,
  activities,
  explicitActivityId,
  selectedActivityId,
}: {
  message: string;
  activities: unknown;
  explicitActivityId?: string;
  selectedActivityId?: string;
}): string | null {
  if (explicitActivityId && String(explicitActivityId).trim()) {
    return String(explicitActivityId).trim();
  }
  if (selectedActivityId && String(selectedActivityId).trim()) {
    return String(selectedActivityId).trim();
  }

  const sorted = sortActivitiesNewestFirst(activities);

  const idInMessage = message.match(/\b(?:activity|act)\s*[#:]?\s*([0-9]{4,})\b/i);
  if (idInMessage?.[1]) return idInMessage[1];

  const bareLongId = message.match(/\b([0-9]{7,})\b/);
  if (bareLongId?.[1]) return bareLongId[1];

  const lower = message.toLowerCase();
  if (/\b(last|latest|most recent|this run|that run|today'?s run|yesterday'?s run)\b/i.test(message)) {
    const id = pickString(sorted[0] ?? {}, ["id"]);
    return id;
  }

  for (const a of sorted) {
    const name = (pickString(a, ["name", "title"]) || "").toLowerCase();
    if (name.length >= 4 && lower.includes(name)) {
      return pickString(a, ["id"]);
    }
  }

  return null;
}
