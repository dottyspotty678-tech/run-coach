import { syncStravaActivities } from "@/lib/strava";
import { isMicrosoftConnected, syncCalendarEvents } from "@/lib/microsoft";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  try {
    results.strava = await syncStravaActivities();
  } catch (err) {
    results.strava = { error: err instanceof Error ? err.message : "sync failed" };
  }

  try {
    results.calendar = (await isMicrosoftConnected())
      ? await syncCalendarEvents()
      : { skipped: "not connected" };
  } catch (err) {
    results.calendar = { error: err instanceof Error ? err.message : "sync failed" };
  }

  return NextResponse.json(results);
}
