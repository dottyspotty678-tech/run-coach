import type { TrainingDay, WorkoutStep } from "@/lib/planTypes";

// Watch sync via intervals.icu (docs/WATCH-SYNC.md). The conversion half of
// this file is PURE — the only import above is type-only, so Node can run
// scripts/intervals.test.mts against it directly. The thin client (pushWeek)
// reaches the database through dynamic imports so loading this module never
// drags Supabase in.
//
// API facts (§1): HTTP Basic `API_KEY:<key>`, athlete `0` = the key's owner;
// POST /events/bulk?upsert=true matches on external_id; PUT /events/bulk-delete
// takes [{ external_id }] and ignores unknown ids.

export type IcuEventType = "Run" | "WeightTraining";

export type IcuEvent = {
  category: "WORKOUT";
  /** Local wall-clock time, no zone: "2026-09-22T18:30:00". */
  start_date_local: string;
  type: IcuEventType;
  name: string;
  /** Workout text (parsed into steps) or plain prose. */
  description: string;
  /** Seconds. */
  moving_time: number;
  /** "runcoach:<YYYY-MM-DD>" — the upsert/delete key. */
  external_id: string;
  target?: "PACE";
};

export type PushResult = {
  ok: boolean;
  pushed: number;
  deleted: number;
  error?: string;
};

const ICU_BASE = "https://intervals.icu/api/v1";
const RUN_TYPES = new Set(["easy", "tempo", "intervals", "long", "race"]);
const WEEKDAY_START = "18:30:00";
const WEEKEND_START = "09:00:00";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
}

/** The seven dates of a Monday-start week. */
export function weekDatesOf(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function externalIdFor(date: string): string {
  return `runcoach:${date}`;
}

/** Default start: weekdays 18:30, Saturday/Sunday 09:00 (local wall clock). */
export function startTimeFor(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sunday … 6 Saturday
  const time = dow === 0 || dow === 6 ? WEEKEND_START : WEEKDAY_START;
  return `${date}T${time}`;
}

function durationToken(step: Extract<WorkoutStep, { kind: "step" }>): string {
  if (step.minutes !== undefined) {
    const mins = step.minutes;
    if (Number.isInteger(mins)) return `${mins}m`;
    return `${Math.round(mins * 60)}s`;
  }
  const km = step.km ?? 0;
  if (km < 1) return `${Math.round(km * 1000)}mtr`;
  const rounded = Math.round(km * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2).replace(/0+$/, "")}km`;
}

function paceToken(step: Extract<WorkoutStep, { kind: "step" }>): string {
  const lo = step.pace_low;
  const hi = step.pace_high;
  if (!lo && !hi) return "";
  if (lo && hi && lo !== hi) return ` ${lo}-${hi}/km Pace`;
  return ` ${lo ?? hi}/km Pace`;
}

/** One plain step as a workout-text line ("- Warmup 10m 5:00-5:30/km Pace"). */
export function stepLine(step: Extract<WorkoutStep, { kind: "step" }>, indent = ""): string {
  const label = step.label?.trim();
  return `${indent}- ${label ? `${label} ` : ""}${durationToken(step)}${paceToken(step)}`;
}

/**
 * Steps → intervals.icu workout text: one step per line; a repeat is a blank
 * line, "- Nx", the indented block, then a blank line (§1 syntax).
 */
export function stepsToWorkoutText(steps: WorkoutStep[]): string {
  const lines: string[] = [];
  for (const step of steps) {
    if (step.kind === "repeat") {
      if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      lines.push(`- ${step.times}x`);
      for (const inner of step.steps) {
        if (inner.kind === "step") lines.push(stepLine(inner, "  "));
      }
      lines.push("");
      continue;
    }
    lines.push(stepLine(step));
  }
  // Trim a trailing blank line left by a final repeat block.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

/** Workout text for a run: steps when present, otherwise the prose fallback. */
export function workoutTextFor(day: TrainingDay): string {
  if (day.steps && day.steps.length > 0) return stepsToWorkoutText(day.steps);
  return proseFor(day);
}

function proseFor(day: TrainingDay): string {
  return [day.detail.trim(), day.why.trim()].filter(Boolean).join("\n\n");
}

/**
 * One event per pushable day of the week: runs as structured "Run" workouts
 * (pace target), strength as "WeightTraining" with the session text; rest and
 * cross days produce nothing (cross training is the runner's own thing).
 */
export function eventsForWeek(days: TrainingDay[], weekStart: string): IcuEvent[] {
  const dates = new Set(weekDatesOf(weekStart));
  const events: IcuEvent[] = [];
  for (const day of days) {
    if (!dates.has(day.date)) continue;
    if (RUN_TYPES.has(day.session_type)) {
      events.push({
        category: "WORKOUT",
        start_date_local: startTimeFor(day.date),
        type: "Run",
        name: day.title,
        description: workoutTextFor(day),
        moving_time: Math.max(0, Math.round(day.duration_min * 60)),
        external_id: externalIdFor(day.date),
        target: "PACE",
      });
    } else if (day.session_type === "strength") {
      events.push({
        category: "WORKOUT",
        start_date_local: startTimeFor(day.date),
        type: "WeightTraining",
        name: day.title,
        description: proseFor(day),
        moving_time: Math.max(0, Math.round(day.duration_min * 60)),
        external_id: externalIdFor(day.date),
      });
    }
  }
  return events.sort((a, b) => a.start_date_local.localeCompare(b.start_date_local));
}

// ---------------------------------------------------------------------------
// Thin client
// ---------------------------------------------------------------------------

type IcuCredentials = { key: string; athleteId: string };

function credentials(): IcuCredentials | null {
  const key = process.env.INTERVALS_ICU_API_KEY?.trim();
  if (!key) return null;
  return { key, athleteId: process.env.INTERVALS_ICU_ATHLETE_ID?.trim() || "0" };
}

/** True when the intervals.icu key is configured (Settings connection card). */
export function isIntervalsConfigured(): boolean {
  return credentials() !== null;
}

async function icuRequest(creds: IcuCredentials, method: "POST" | "PUT", path: string, body: unknown) {
  const auth = Buffer.from(`API_KEY:${creds.key}`).toString("base64");
  const res = await fetch(`${ICU_BASE}/athlete/${encodeURIComponent(creds.athleteId)}${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`intervals.icu ${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

/**
 * Upserts the week's events, then bulk-deletes the external ids of the week's
 * other dates (a day that became rest disappears from the watch). Never
 * throws — the outcome comes back as a PushResult.
 */
export async function pushEvents(events: IcuEvent[], weekStart: string): Promise<PushResult> {
  const creds = credentials();
  if (!creds) {
    return { ok: false, pushed: 0, deleted: 0, error: "INTERVALS_ICU_API_KEY is not set" };
  }
  const pushedIds = new Set(events.map((e) => e.external_id));
  const stale = weekDatesOf(weekStart)
    .map(externalIdFor)
    .filter((id) => !pushedIds.has(id))
    .map((external_id) => ({ external_id }));
  try {
    if (events.length > 0) await icuRequest(creds, "POST", "/events/bulk?upsert=true", events);
    if (stale.length > 0) await icuRequest(creds, "PUT", "/events/bulk-delete", stale);
    return { ok: true, pushed: events.length, deleted: stale.length };
  } catch (err) {
    return {
      ok: false,
      pushed: 0,
      deleted: 0,
      error: err instanceof Error ? err.message : "Unknown intervals.icu error",
    };
  }
}

/**
 * Loads the stored plan for a Monday, pushes it and records the outcome in
 * watch_sync. Never throws. Database access is through dynamic imports so the
 * pure half of this module stays loadable outside Next.
 */
export async function pushWeek(weekStart: string): Promise<PushResult> {
  let result: PushResult;
  try {
    const [{ getPlanForWeek }, { parseTrainingDays }] = await Promise.all([
      import("@/components/data"),
      import("@/lib/planTypes"),
    ]);
    const plan = await getPlanForWeek(weekStart);
    const days = parseTrainingDays(plan);
    if (!days) {
      result = { ok: false, pushed: 0, deleted: 0, error: "No structured plan stored for this week" };
    } else {
      result = await pushEvents(eventsForWeek(days, weekStart), weekStart);
    }
  } catch (err) {
    result = {
      ok: false,
      pushed: 0,
      deleted: 0,
      error: err instanceof Error ? err.message : "Unknown error loading the plan",
    };
  }
  await recordWatchSync(weekStart, result);
  return result;
}

async function recordWatchSync(weekStart: string, result: PushResult): Promise<void> {
  try {
    const { createServiceClient } = await import("@/lib/supabase/service");
    const supabase = createServiceClient();
    const payload: Record<string, unknown> = result.ok
      ? {
          week_start_date: weekStart,
          pushed_at: new Date().toISOString(),
          events_pushed: result.pushed,
          last_error: null,
        }
      : // Partial upsert: a failure never blanks the last successful push.
        { week_start_date: weekStart, last_error: result.error ?? "Unknown error" };
    const { error } = await supabase.from("watch_sync").upsert(payload);
    if (error) console.warn("watch_sync upsert failed (run the watch sync migration?):", error.message);
  } catch (err) {
    console.warn("watch_sync bookkeeping failed:", err instanceof Error ? err.message : err);
  }
}
