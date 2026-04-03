export function getIntervalsEnv() {
  const apiKey = process.env.INTERVALS_ICU_API_KEY;
  const athleteId = process.env.INTERVALS_ICU_ATHLETE_ID;

  if (!apiKey || !athleteId) {
    throw new Error(
      "Missing Intervals.icu env vars. Set INTERVALS_ICU_API_KEY and INTERVALS_ICU_ATHLETE_ID in .env.local.",
    );
  }

  return { apiKey, athleteId };
}

