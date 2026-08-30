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
  /** Round 2 (U6): "manual" = user-logged entry; absent/"strava" = synced. */
  source?: "strava" | "manual";
  /** Manual entries only: manual_activities.id, for edit/delete affordances. */
  manual_id?: number;
  /** Manual entries only: the optional short note. */
  note?: string | null;
};

export type CalendarEventRow = {
  external_id: string;
  title: string | null;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  is_travel: boolean;
  /** V2: the event's location display name (null pre-migration/no location). */
  location?: string | null;
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

/**
 * Activities in the last N days, newest first — ONE unified stream (round 2,
 * U6): Strava rows merged with manually logged sessions, so every consumer
 * (aggregations, ticks, generation context) sees the same picture. Strava
 * remains the source of truth where both exist; no de-duplication in v1.
 */
export async function getRecentActivities(days: number): Promise<ActivityRow[]> {
  const supabase = createServiceClient();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [{ data }, manual] = await Promise.all([
    supabase
      .from("strava_activities")
      .select("external_id, type, name:raw_json->>name, distance_m, duration_s, start_date, average_pace")
      .gte("start_date", since)
      .order("start_date", { ascending: false }),
    getManualActivities(days),
  ]);
  const strava = ((data as ActivityRow[] | null) ?? []).map((a) => ({
    ...a,
    source: "strava" as const,
  }));
  return [...strava, ...manual.map(manualToActivityRow)].sort((a, b) =>
    b.start_date.localeCompare(a.start_date)
  );
}

// ---------------------------------------------------------------------------
// Manually logged sessions (round 2, U6) — read side. Interface contract in
// docs/DESIGN.md §8b. Degrades silently until the Round 2 migration runs.
// ---------------------------------------------------------------------------

export type ManualActivityRow = {
  id: number;
  /** YYYY-MM-DD (London calendar date of the session). */
  activity_date: string;
  /** A plan session type ("easy", "strength", …) or free text ("football"). */
  type: string;
  duration_min: number;
  distance_km: number | null;
  note: string | null;
  created_at: string;
};

/** Manual sessions in the last N days, newest first. */
export async function getManualActivities(days: number): Promise<ManualActivityRow[]> {
  try {
    const supabase = createServiceClient();
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("manual_activities")
      .select("id, activity_date, type, duration_min, distance_km, note, created_at")
      .gte("activity_date", since)
      .order("activity_date", { ascending: false });
    if (error || !data) return [];
    return data as ManualActivityRow[];
  } catch {
    return [];
  }
}

/**
 * A manual entry as a unified ActivityRow. external_id is the negated manual
 * id so it can never collide with (positive) Strava ids; noon UTC keeps the
 * London calendar date stable in both GMT and BST.
 */
export function manualToActivityRow(m: ManualActivityRow): ActivityRow {
  return {
    external_id: -m.id,
    type: m.type,
    name: m.note?.trim() || null,
    distance_m: m.distance_km != null ? m.distance_km * 1000 : 0,
    duration_s: m.duration_min * 60,
    start_date: `${m.activity_date}T12:00:00Z`,
    average_pace: null,
    source: "manual",
    manual_id: m.id,
    note: m.note,
  };
}

// ---------------------------------------------------------------------------
// Activity typing (fix round 1, U1): running figures count only runs; other
// activities are supporting training, surfaced separately and never merged
// into running distance or pace.
// ---------------------------------------------------------------------------

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);
const STRENGTH_TYPES = new Set(["WeightTraining", "Workout", "Crossfit"]);
// Manual entries use plan session types (round 2, U6) — the running ones.
const MANUAL_RUN_TYPES = new Set(["run", "easy", "tempo", "intervals", "long", "race"]);

/** True for running types: Strava Run/TrailRun/VirtualRun, or a manual run-flavoured type. */
export function isRun(type: string): boolean {
  if (RUN_TYPES.has(type)) return true;
  const s = type.toLowerCase().trim();
  return MANUAL_RUN_TYPES.has(s) || s.includes("run");
}

export type ActivityCategory = "run" | "strength" | "other";

export function activityCategory(type: string): ActivityCategory {
  if (isRun(type)) return "run";
  if (STRENGTH_TYPES.has(type)) return "strength";
  const s = type.toLowerCase();
  if (s.includes("strength") || s.includes("gym") || s.includes("weight")) return "strength";
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
  // select("*") so the optional V2 `location` column is included when it
  // exists and the query still works before the V2 migration runs.
  const { data } = await supabase
    .from("calendar_events")
    .select("*")
    .lt("start_time", `${weekEnd}T00:00:00Z`)
    .gte("end_time", `${weekStart}T00:00:00Z`)
    .order("start_time", { ascending: true });
  return (data as CalendarEventRow[] | null) ?? [];
}

// ---------------------------------------------------------------------------
// Away/home status engine (V2, REDESIGN-V2.md §Away/home). Governs MEALS
// (meal-prep model); the is_travel flag continues to govern TRAINING.
// Home is the default. A day is AWAY when:
//   1. a hotel-booking pattern starts a span: an event whose title looks like
//      a check-in / hotel booking sets away from that day until the day
//      before the matching check-out event (or the day before the event's
//      own end for multi-day bookings); or
//   2. an event carries a location that is NOT a home base (Manchester and
//      London are home — explicit user decision): away from that day until
//      the day before the event ends (so a same-day trip has no away days —
//      the runner is home for dinner).
// Events with no location and no hotel pattern do not change status. Virtual
// "locations" (Teams/Zoom/etc.) are treated as no location.
// ---------------------------------------------------------------------------

const HOME_BASES = ["manchester", "london"];
const VIRTUAL_LOCATION_HINTS = [
  "teams",
  "zoom",
  "webex",
  "google meet",
  "skype",
  "online",
  "virtual",
  "call",
];
const HOTEL_TITLE_PATTERNS = [
  /check[\s-]?in/i,
  /\bhotel\b/i,
  /booking confirmation/i,
  /reservation/i,
];
const CHECKOUT_TITLE_PATTERN = /check[\s-]?out/i;

function isAwayLocation(location: string | null | undefined): boolean {
  const loc = location?.trim().toLowerCase();
  if (!loc) return false;
  if (VIRTUAL_LOCATION_HINTS.some((v) => loc.includes(v))) return false;
  return !HOME_BASES.some((h) => loc.includes(h));
}

/**
 * The subset of `dates` (YYYY-MM-DD, London, ascending) on which the runner
 * is AWAY, per the V2 rules above. Used by the Nutrition/Dashboard UI and by
 * plan generation — one shared engine so they can never disagree.
 */
export function awayDatesForRange(events: CalendarEventRow[], dates: string[]): Set<string> {
  const away = new Set<string>();
  const rangeSet = new Set(dates);
  const rangeEnd = dates[dates.length - 1];
  if (!rangeEnd) return away;

  // Check-out events terminate hotel spans; collect their (London) dates.
  const checkoutDates = events
    .filter((e) => CHECKOUT_TITLE_PATTERN.test(e.title ?? ""))
    .map((e) => londonDateOf(e.start_time))
    .sort();

  const markSpan = (first: string, last: string) => {
    for (let d = first; d <= last && d <= rangeEnd; d = addDays(d, 1)) {
      if (rangeSet.has(d)) away.add(d);
    }
  };

  for (const e of events) {
    const title = e.title ?? "";
    if (CHECKOUT_TITLE_PATTERN.test(title)) continue; // terminator only

    const hotel = HOTEL_TITLE_PATTERNS.some((p) => p.test(title));
    const awayLocation = isAwayLocation(e.location);
    if (!hotel && !awayLocation) continue;

    const start = londonDateOf(e.start_time);
    let last = addDays(londonDateOf(e.end_time), -1); // home again on the end day

    if (hotel) {
      const checkout = checkoutDates.find((c) => c >= start);
      if (checkout) last = addDays(checkout, -1);
      // A check-in implies at least one night away even when the event
      // itself is a single-day marker.
      if (last < start) last = start;
    } else if (last < start) {
      continue; // same-day trip with a location: home for dinner
    }

    markSpan(start, last);
  }

  return away;
}

// ---------------------------------------------------------------------------
// Pending plan changes (V2, REDESIGN-V2.md §Screen 2) — read side. Interface
// contract in docs/DESIGN.md §8d. Degrades silently pre-migration.
// ---------------------------------------------------------------------------

export type PendingChange = {
  /** Stable id for remove affordances (crypto.randomUUID). */
  id: string;
  /** YYYY-MM-DD within the plan week, or null for a general instruction. */
  date: string | null;
  /** Requested session type (a plan SessionType value), or null. */
  requested_type: string | null;
  /** Free-text instruction, or null. */
  instruction: string | null;
};

export type PendingChangesRow = {
  week_start_date: string;
  changes: PendingChange[];
  checkin_note: string;
  updated_at: string;
};

/** Pending (not yet applied) plan changes for a week, or null when none. */
export async function getPendingChanges(weekStart: string): Promise<PendingChangesRow | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("pending_changes")
      .select("week_start_date, changes, checkin_note, updated_at")
      .eq("week_start_date", weekStart)
      .maybeSingle();
    if (error || !data) return null;
    const raw = Array.isArray(data.changes) ? (data.changes as unknown[]) : [];
    const changes: PendingChange[] = raw
      .filter(
        (c: unknown): c is Record<string, unknown> =>
          typeof c === "object" &&
          c !== null &&
          typeof (c as Record<string, unknown>).id === "string"
      )
      .map((c) => ({
        id: String(c.id),
        date: typeof c.date === "string" ? c.date : null,
        requested_type: typeof c.requested_type === "string" ? c.requested_type : null,
        instruction: typeof c.instruction === "string" ? c.instruction : null,
      }));
    return {
      week_start_date: data.week_start_date as string,
      changes,
      checkin_note: typeof data.checkin_note === "string" ? data.checkin_note : "",
      updated_at: data.updated_at as string,
    };
  } catch {
    return null;
  }
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

export type AppliedCheckinRow = {
  week_start_date: string;
  applied_at: string;
};

/**
 * The latest APPLIED voice check-in targeting any of the given plan weeks
 * (§3.12) — drives the Dashboard's done state and the Check-in screen's
 * revise mode. Null when none (or pre-migration).
 */
export async function getLatestAppliedCheckin(
  weekStarts: string[]
): Promise<AppliedCheckinRow | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("voice_checkins")
      .select("week_start_date, applied_at")
      .in("week_start_date", weekStarts)
      .eq("status", "applied")
      .order("applied_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data as AppliedCheckinRow;
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

// ---------------------------------------------------------------------------
// Injury history (round 2, U5) — read side. Interface contract in
// docs/DESIGN.md §8b. Degrades silently until the Round 2 migration runs.
// Free-text fields, voice-transcript-friendly like U4.
// ---------------------------------------------------------------------------

export type InjuryHistoryRow = {
  id: number;
  /** e.g. "calf strain" */
  description: string;
  /** Rough free-text period, e.g. "winter 2024, ~6 weeks off". May be "". */
  period: string;
  created_at: string;
};

/** Past injuries, newest first. */
export async function getInjuryHistory(): Promise<InjuryHistoryRow[]> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("injury_history")
      .select("id, description, period, created_at")
      .order("created_at", { ascending: false });
    if (error || !data) return [];
    return data as InjuryHistoryRow[];
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
