import { NextResponse } from "next/server";
import { fetchIntervalsRecent } from "@/lib/intervals/intervals-client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const daysParam = searchParams.get("days");
  const limitParam = searchParams.get("limit");

  const days = daysParam ? Number(daysParam) : 14;
  const limit = limitParam ? Number(limitParam) : 20;

  try {
    const data = await fetchIntervalsRecent({
      days: Number.isFinite(days) ? days : 30,
      limit: Number.isFinite(limit) ? limit : 20,
    });

    // Log raw wellness to help diagnose field-name mismatches
    const wellnessArr = Array.isArray(data.wellness) ? data.wellness : [];
    console.log(
      "[intervals/recent] wellness count:", wellnessArr.length,
      "| date range:", data.meta.oldest, "→", data.meta.newest,
    );
    if (wellnessArr.length > 0) {
      const newest = wellnessArr[wellnessArr.length - 1];
      const oldest = wellnessArr[0];
      console.log("[intervals/recent] wellness[0] (oldest) keys+values:", JSON.stringify(oldest, null, 2));
      console.log("[intervals/recent] wellness[-1] (newest) raw JSON:", JSON.stringify(newest, null, 2));
      console.log("[intervals/recent] wellness[-1] (newest) Object.keys():", Object.keys(newest as object));
    }

    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error fetching Intervals.icu data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

