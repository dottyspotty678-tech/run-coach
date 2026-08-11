import { syncStravaActivities } from "@/lib/strava";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const result = await syncStravaActivities();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sync failed" },
      { status: 500 }
    );
  }
}
