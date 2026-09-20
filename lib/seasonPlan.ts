import { createServiceClient } from "@/lib/supabase/service";
import { boundaryWeekStart, mondayOf, todayISO, addDays } from "@/components/dates";
import {
  getRaces,
  getRecentActivities,
  getRecentFeedback,
  getSeasonPlan,
  isRun,
  type RaceRow,
} from "@/components/data";
import { computeSeason, type SeasonWeek } from "@/lib/season";

// Season plan refresh (docs/SEASON-PLAN.md §3–§4): loads the planner's inputs
// (races, current fitness from the unified activity stream, stored rows, the
// rolling-7-day LOAD FLAG and the latest check-in tone), runs the pure
// planner with the stability merge, and upserts season_plan. Called at the
// start of every plan generation and from every races server action. Degrades
// to [] (with a warning) until the V3 season migration has run.

const HORIZON_WEEKS = 35;
const TOO_HARD = /too hard|too much|exhaust|wiped|knackered|flat|overdid|struggl/i;

export type SeasonRefresh = {
  weeks: SeasonWeek[];
  races: RaceRow[];
  /** Set when the plan was computed but could not be stored, or the refresh failed. */
  warning?: string;
  /** Per-step timings ("races 120ms"), so a stalled call can be named. */
  trace: string[];
};

// No database call may stall the planner: a hung request would otherwise
// freeze every plan generation until the platform kills the function.
const STEP_TIMEOUT_MS = 15000;

async function timed<T>(label: string, trace: string[], work: Promise<T>): Promise<T> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${STEP_TIMEOUT_MS} ms`)),
      STEP_TIMEOUT_MS
    );
  });
  try {
    const result = await Promise.race([work, timeout]);
    trace.push(`${label} ${Date.now() - started}ms`);
    return result;
  } catch (err) {
    trace.push(`${label} FAILED after ${Date.now() - started}ms`);
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Diagnostic: the planner's exact inputs, without computing or writing. */
export type SeasonInputsDump = {
  today: string;
  w0: string;
  races: RaceRow[];
  currentFitnessKm: number;
  last7Km: number;
  loadFlag: boolean;
  tooHardCheckin: boolean;
  stored: SeasonWeek[];
  trace: string[];
};

export async function loadSeasonInputs(now: Date = new Date()): Promise<SeasonInputsDump> {
  const today = todayISO(now);
  const w0 = mondayOf(today);
  const trace: string[] = [];
  const [races, activities, stored, feedback] = await Promise.all([
    timed("races", trace, getRaces()),
    timed("activities", trace, getRecentActivities(28)),
    timed("stored season", trace, getSeasonPlan(w0, HORIZON_WEEKS)),
    timed("feedback", trace, getRecentFeedback(1)),
  ]);
  const runs = activities.filter((a) => isRun(a.type));
  const dayMs = 86400000;
  const kmBetween = (fromDaysAgo: number, toDaysAgo: number) =>
    runs
      .filter((a) => {
        const age = now.getTime() - new Date(a.start_date).getTime();
        return age > toDaysAgo * dayMs && age <= fromDaysAgo * dayMs;
      })
      .reduce((sum, a) => sum + a.distance_m / 1000, 0);
  const last7 = kmBetween(7, 0);
  const prev7 = kmBetween(14, 7);
  const latest = feedback[0];
  return {
    today,
    w0,
    races,
    currentFitnessKm: runs.reduce((sum, a) => sum + a.distance_m / 1000, 0) / 4,
    last7Km: last7,
    loadFlag: prev7 > 0 && last7 > prev7 * 1.1,
    tooHardCheckin:
      !!latest && latest.week_start_date >= addDays(w0, -14) && TOO_HARD.test(latest.feedback),
    stored,
    trace,
  };
}

export async function refreshSeasonPlan(now: Date = new Date()): Promise<SeasonRefresh> {
  const today = todayISO(now);
  const w0 = mondayOf(today);
  const trace: string[] = [];
  try {
    const [races, activities, stored, feedback] = await Promise.all([
      timed("races", trace, getRaces()),
      timed("activities", trace, getRecentActivities(28)),
      timed("stored season", trace, getSeasonPlan(w0, HORIZON_WEEKS)),
      timed("feedback", trace, getRecentFeedback(1)),
    ]);

    // Current fitness: 4-week average weekly running km (falls back to last 7).
    const runs = activities.filter((a) => isRun(a.type));
    const dayMs = 86400000;
    const kmBetween = (fromDaysAgo: number, toDaysAgo: number) =>
      runs
        .filter((a) => {
          const age = now.getTime() - new Date(a.start_date).getTime();
          return age > toDaysAgo * dayMs && age <= fromDaysAgo * dayMs;
        })
        .reduce((sum, a) => sum + a.distance_m / 1000, 0);
    const total28 = runs.reduce((sum, a) => sum + a.distance_m / 1000, 0);
    const last7 = kmBetween(7, 0);
    const prev7 = kmBetween(14, 7);
    const fourWeekAvg = total28 / 4;
    const loadFlag = prev7 > 0 && last7 > prev7 * 1.1;

    // Latest check-in tone — only a recent note counts (the last two weeks).
    const latest = feedback[0];
    const tooHardCheckin =
      !!latest && latest.week_start_date >= addDays(w0, -14) && TOO_HARD.test(latest.feedback);

    const weeks = computeSeason({
      races,
      today,
      currentFitnessKm: fourWeekAvg,
      last7Km: last7,
      runningCeilingKm: last7 > 0 ? last7 * 1.1 : null,
      stored,
      loadFlag,
      tooHardCheckin,
      holdWeek: boundaryWeekStart(now),
      // Blocks count from the week being planned; stored near weeks keep
      // their positions so refreshes continue the sequence.
      blockStartWeek: boundaryWeekStart(now),
      weeks: HORIZON_WEEKS,
    });

    const supabase = createServiceClient();
    const generatedAt = now.toISOString();
    const { error } = await timed(
      "upsert",
      trace,
      Promise.resolve(
        // Every row must carry the same keys: PostgREST fills a key missing
        // from some rows of a bulk upsert with NULL (not the column default),
        // which violates volume_override's NOT NULL constraint.
        supabase.from("season_plan").upsert(
          weeks.map((w) => ({
            ...w,
            volume_override: w.volume_override ?? false,
            generated_at: generatedAt,
          }))
        )
      )
    );
    if (error) {
      // Migration not run yet, or a transient failure: the computed plan is
      // still returned so the caller's prompt has a position to work from.
      console.warn("season_plan upsert failed (run the V3 season migration?):", error.message);
      return { weeks, races, trace, warning: `season_plan upsert failed: ${error.message}` };
    }
    return { weeks, races, trace };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("Season plan refresh failed:", message, trace.join(", "));
    return { weeks: [], races: [], trace, warning: `Season plan refresh failed: ${message}` };
  }
}
