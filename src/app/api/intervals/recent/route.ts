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
      days: Number.isFinite(days) ? days : 14,
      limit: Number.isFinite(limit) ? limit : 20,
    });
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error fetching Intervals.icu data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

