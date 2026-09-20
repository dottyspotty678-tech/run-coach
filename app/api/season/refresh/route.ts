import { NextResponse } from "next/server";
import { refreshSeasonPlan } from "@/lib/seasonPlan";

// Re-runs the season planner on demand (PIN-gated by the middleware like every
// other /api route). No Claude call. Returns the storage warning, if any, and
// the near weeks so the result can be checked without opening the app.
// Vercel sets this at build time; it tells us which commit is actually live.
const COMMIT = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";

/** Ping: no work, just the live commit — separates "route unreachable" from "planner hangs". */
export async function GET() {
  return NextResponse.json({ ok: true, commit: COMMIT });
}

export async function POST() {
  const result = await refreshSeasonPlan();
  return NextResponse.json({
    ok: !result.warning,
    commit: COMMIT,
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
