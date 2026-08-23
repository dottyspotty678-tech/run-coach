// Server-side read helpers for the UI. Read-only; all writes stay in lib/ and
// app/api (backend territory).

import { createServiceClient } from "@/lib/supabase/service";
import type { SessionType, WeeklyPlanRow } from "@/lib/planTypes";
import { addDays, londonDateOf } from "@/components/dates";

export type ActivityRow = {
  external_id: number;
  type: string;
  name: string | null;
  distance_m: number;
  duration_s: number;
  start_date: string;
  average_pace: number | null;
};

export type CalendarEventRow = {
  external_id: string;
  title: string | null;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  is_travel: boolean;
};

export type SyncStatus = {
  last_synced_at: string | null;
  last_error: string | null;
};

/** Weekly plan for a specific Monday, or null. */
export async function getPlanForWeek(weekStart: string): Promise<WeeklyPlanRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("weekly_plans")
    .select("*")
    .eq("week_start_date", weekStart)
    .maybeSingle();
  return (data as WeeklyPlanRow | null) ?? null;
}

/** Activities in the last N days, newest first. */
export async function getRecentActivities(days: number): Promise<ActivityRow[]> {
  const supabase = createServiceClient();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data } = await supabase
    .from("strava_activities")
    .select("external_id, type, name:raw_json->>name, distance_m, duration_s, start_date, average_pace")
    .gte("start_date", since)
    .order("start_date", { ascending: false });
  return (data as ActivityRow[] | null) ?? [];
}

// ---------------------------------------------------------------------------
// Activity typing (fix round 1, U1): running figures count only runs; other
// activities are supporting training, surfaced separately and never merged
// into running distance or pace.
// ---------------------------------------------------------------------------

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);
const STRENGTH_TYPES = new Set(["WeightTraining", "Workout", "Crossfit"]);

/** True for Strava running types (Run / TrailRun / VirtualRun). */
export function isRun(type: string): boolean {
  return RUN_TYPES.has(type);
}

export type ActivityCategory = "run" | "strength" | "other";

export function activityCategory(type: string): ActivityCategory {
  if (isRun(type)) return "run";
  if (STRENGTH_TYPES.has(type)) return "strength";
  return "other";
}

/** Total km of runs only, optionally restricted to the last N days. */
export function runKm(activities: ActivityRow[], withinDays?: number, now: Date = new Date()): number {
  return activities
    .filter((a) => isRun(a.type))
    .filter(
      (a) =>
        withinDays === undefined ||
        now.getTime() - new Date(a.start_date).getTime() <= withinDays * 86400000
    )
    .reduce((s, a) => s + a.distance_m / 1000, 0);
}

/** London dates (YYYY-MM-DD) → the categories of activity completed that day. */
export function completedCategories(activities: ActivityRow[]): Map<string, Set<ActivityCategory>> {
  const out = new Map<string, Set<ActivityCategory>>();
  for (const a of activities) {
    const date = londonDateOf(a.start_date);
    const set = out.get(date) ?? new Set<ActivityCategory>();
    set.add(activityCategory(a.type));
    out.set(date, set);
  }
  return out;
}

/**
 * Type-aware completion tick (U1): a planned session only ticks when a
 * matching activity type exists that day — a bike ride does not complete an
 * interval session. With no planned session (old-format plans) any activity
 * counts, preserving the pre-fix behaviour.
 */
export function sessionDone(
  sessionType: SessionType | undefined,
  categories: Set<ActivityCategory> | undefined
): boolean {
  if (!categories || categories.size === 0) return false;
  if (!sessionType) return true; // old-format plan: any activity ticks
  switch (sessionType) {
    case "rest":
      return false; // nothing to complete
    case "strength":
      return categories.has("strength");
    case "cross":
      return categories.has("strength") || categories.has("other");
    default:
      return categories.has("run"); // easy / tempo / intervals / long / race
  }
}

/** Calendar events overlapping a Monday-start week. */
export async function getEventsForWeek(weekStart: string): Promise<CalendarEventRow[]> {
  const supabase = createServiceClient();
  const weekEnd = addDays(weekStart, 7);
  const { data } = await supabase
    .from("calendar_events")
    .select("external_id, title, start_time, end_time, is_all_day, is_travel")
    .lt("start_time", `${weekEnd}T00:00:00Z`)
    .gte("end_time", `${weekStart}T00:00:00Z`)
    .order("start_time", { ascending: true });
  return (data as CalendarEventRow[] | null) ?? [];
}

/** Days of the week flagged as travel by calendar events (fallback when the plan is old-format). */
export function travelDatesFromEvents(events: CalendarEventRow[], weekDatesList: string[]): Set<string> {
  const travel = new Set<string>();
  for (const e of events) {
    if (!e.is_travel) continue;
    const start = londonDateOf(e.start_time);
    const end = londonDateOf(e.end_time);
    for (const d of weekDatesList) {
      if (d >= start && d <= end) travel.add(d);
    }
  }
  return travel;
}

/**
 * Per-provider sync status. Reads the `sync_status` table
 * ({ provider, last_synced_at, last_error }) and degrades silently to an
 * empty map when the table does not exist yet (backend migration pending).
 */
export async function getSyncStatus(): Promise<Partial<Record<"strava" | "microsoft", SyncStatus>>> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("sync_status")
      .select("provider, last_synced_at, last_error");
    if (error || !data) return {};
    const out: Partial<Record<"strava" | "microsoft", SyncStatus>> = {};
    for (const row of data as Array<{ provider: string } & SyncStatus>) {
      if (row.provider === "strava" || row.provider === "microsoft") {
        out[row.provider] = { last_synced_at: row.last_synced_at, last_error: row.last_error };
      }
    }
    return out;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Context & feedback (fix round 1, U4) — read side. Interface contract in
// docs/DESIGN.md §8. Both degrade silently when the tables do not exist yet
// (migration pending). Free-text fields, so a future voice-transcript flow
// can populate the same rows.
// ---------------------------------------------------------------------------

export type RunnerContext = {
  injuries: string;
  updated_at: string;
};

/** Persistent "current injuries / niggles" free text, or null when unset/empty. */
export async function getRunnerContext(): Promise<RunnerContext | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("runner_context")
      .select("injuries, updated_at")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return null;
    return data as RunnerContext;
  } catch {
    return null;
  }
}

export type WeeklyFeedbackRow = {
  /** Monday of the week the note describes (YYYY-MM-DD). */
  week_start_date: string;
  feedback: string;
  updated_at: string;
};

/**
 * Recent weekly feedback notes, most recent first. Pass `beforeWeek` to
 * exclude the target week itself when building generation context.
 */
export async function getRecentFeedback(
  limit = 3,
  beforeWeek?: string
): Promise<WeeklyFeedbackRow[]> {
  try {
    const supabase = createServiceClient();
    let query = supabase
      .from("weekly_feedback")
      .select("week_start_date, feedback, updated_at")
      .order("week_start_date", { ascending: false })
      .limit(limit);
    if (beforeWeek) query = query.lt("week_start_date", beforeWeek);
    const { data, error } = await query;
    if (error || !data) return [];
    return data as WeeklyFeedbackRow[];
  } catch {
    return [];
  }
}

/** Most recent successful sync across providers, or null when unknown. */
export function lastSuccessfulSync(
  status: Partial<Record<"strava" | "microsoft", SyncStatus>>
): string | null {
  const times = Object.values(status)
    .map((s) => s?.last_synced_at)
    .filter((t): t is string => !!t)
    .sort();
  return times.length ? times[times.length - 1] : null;
}
