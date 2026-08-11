import { syncStravaActivities } from "@/lib/strava";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
