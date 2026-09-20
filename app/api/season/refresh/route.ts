import { NextResponse } from "next/server";
import { refreshSeasonPlan } from "@/lib/seasonPlan";

// Re-runs the season planner on demand (PIN-gated by the middleware like every
// other /api route). No Claude call. Returns the storage warning, if any, and
// the near weeks so the result can be checked without opening the app.
export async function POST() {
  const result = await refreshSeasonPlan();
  return NextResponse.json({
    ok: !result.warning,
    warning: result.warning ?? null,
    trace: result.trace,
    races: result.races.length,
    weeks: result.weeks.slice(0, 10).map((w) => ({
      week: w.week_start_date,
      phase: w.phase,
      block: w.block_position,
      band: `${w.volume_low_km}-${w.volume_high_km}`,
      stability: w.stability,
      override: w.volume_override ?? false,
    })),
  });
}
