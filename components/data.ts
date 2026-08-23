// Server-side read helpers for the UI. Read-only; all writes stay in lib/ and
// app/api (backend territory).

import { createServiceClient } from "@/lib/supabase/service";
import type { WeeklyPlanRow } from "@/lib/planTypes";
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

/** Set of London dates (YYYY-MM-DD) that have at least one activity. */
export function completedDates(activities: ActivityRow[]): Set<string> {
  return new Set(activities.map((a) => londonDateOf(a.start_date)));
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
