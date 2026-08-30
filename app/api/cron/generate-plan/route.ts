import { generateWeeklyPlan, getCurrentWeeklyPlan } from "@/lib/weeklyPlan";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { NextResponse } from "next/server";

// A plan generated or revised this recently is already built on current data
// — typically the Sunday voice check-in or a manual revision from the same
// afternoon. Regenerating over it would discard deliberate changes (only
// voice-check-in agreements survive the fold), so the cron stands down.
const FRESH_PLAN_WINDOW_MS = 12 * 60 * 60 * 1000;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const existing = await getCurrentWeeklyPlan();
    const freshestAt = existing
      ? Math.max(
          new Date(existing.generated_at as string).getTime(),
          existing.revised_at ? new Date(existing.revised_at as string).getTime() : 0
        )
      : 0;
    if (freshestAt > Date.now() - FRESH_PLAN_WINDOW_MS) {
      console.log("Cron generation skipped — plan is fresh:", existing?.week_start_date);
      return NextResponse.json({
        skipped: true,
        reason: "plan generated or revised within the last 12 hours",
        week_start_date: existing?.week_start_date,
      });
    }

    const result = await generateWeeklyPlan();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "generation failed" },
      { status: 500 }
    );
  }
}
