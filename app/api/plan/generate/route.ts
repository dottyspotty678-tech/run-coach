import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generateWeeklyPlan } from "@/lib/weeklyPlan";
import { isStravaConnected, syncStravaActivities } from "@/lib/strava";
import { isMicrosoftConnected, syncCalendarEvents } from "@/lib/microsoft";
import { londonDateOf, todayISO } from "@/components/dates";

// Manual plan generation (REQUIREMENTS §3.7). Server-enforced guardrails,
// tracked in the generation_log table so they survive serverless restarts:
// - minimum 2 minutes between manual generations → 429
// - maximum 8 manual generations per calendar day (Europe/London) → 429
// The Sunday cron is exempt (it calls generateWeeklyPlan directly).
const MIN_INTERVAL_MS = 2 * 60 * 1000;
const MAX_PER_DAY = 8;

export async function POST() {
  const supabase = createServiceClient();

  try {
    // Look back 48 h — more than enough to cover both limits.
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: recent, error: logError } = await supabase
      .from("generation_log")
      .select("requested_at")
      .eq("source", "manual")
      .gte("requested_at", since)
      .order("requested_at", { ascending: false });

    if (!logError && recent) {
      const last = recent[0]?.requested_at;
      if (last && Date.now() - new Date(last).getTime() < MIN_INTERVAL_MS) {
        return NextResponse.json(
          { error: "Easy tiger — you can regenerate again in a moment." },
          { status: 429 }
        );
      }
      const today = todayISO();
      const todayCount = recent.filter((r) => londonDateOf(r.requested_at) === today).length;
      if (todayCount >= MAX_PER_DAY) {
        return NextResponse.json(
          {
            error:
              "That's the daily limit on regenerations — the plan refreshes automatically on Sunday.",
          },
          { status: 429 }
        );
      }
    }
    // If the log table is missing (migration not yet run) the limits degrade
    // open rather than blocking the core feature.

    // Record the attempt before the Claude call — failed calls cost money too.
    await supabase.from("generation_log").insert({ source: "manual" });

    // Fresh input, best-effort (§3.7): sync both providers first, but a sync
    // failure never blocks generation — proceed on cached data and note the
    // staleness in the stored input snapshot.
    const syncNotes: string[] = [];
    const [stravaConnected, microsoftConnected] = await Promise.all([
      isStravaConnected(),
      isMicrosoftConnected(),
    ]);
    const results = await Promise.allSettled([
      stravaConnected ? syncStravaActivities() : Promise.resolve(null),
      microsoftConnected ? syncCalendarEvents() : Promise.resolve(null),
    ]);
    if (!stravaConnected) syncNotes.push("Strava not connected — activity data may be stale.");
    else if (results[0].status === "rejected")
      syncNotes.push("Strava sync failed before generation — activity data may be stale.");
    if (!microsoftConnected) syncNotes.push("Calendar not connected — travel data may be stale.");
    else if (results[1].status === "rejected")
      syncNotes.push("Calendar sync failed before generation — travel data may be stale.");

    const result = await generateWeeklyPlan({ syncNotes });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Manual plan generation failed:", err);
    return NextResponse.json(
      { error: "Couldn't generate the plan — try again in a minute." },
      { status: 500 }
    );
  }
}
