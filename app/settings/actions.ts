"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { refreshSeasonPlan } from "@/lib/seasonPlan";
import { parseIntervalText } from "@/lib/season";
import { boundaryWeekStart, mondayOf, todayISO } from "@/components/dates";
import { revalidatePath } from "next/cache";

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function saveSettings(formData: FormData) {
  const supabase = createServiceClient();

  await supabase.from("settings").upsert({
    id: true,
    weight_goal: formData.get("weight_goal") as string,
    dietary_restrictions: splitList(String(formData.get("dietary_restrictions") ?? "")),
    disliked_ingredients: splitList(String(formData.get("disliked_ingredients") ?? "")),
    household_size: Number(formData.get("household_size") ?? 1),
  });

  revalidatePath("/settings");
}

// ---------------------------------------------------------------------------
// Races (v3, docs/SEASON-PLAN.md §1–§2) — write side. Interface contract in
// docs/DESIGN.md §8e. Every write re-runs the season planner so the Plan,
// Dashboard and the next generation see the new structure immediately.
// ---------------------------------------------------------------------------

const RACE_PATHS = ["/settings", "/", "/plan", "/season"];

function revalidateRaces() {
  for (const p of RACE_PATHS) revalidatePath(p);
}

/** "hh:mm:ss" / "h:mm" / "N minutes" → Postgres interval text, or null. */
function toIntervalText(raw: string): string | null {
  return parseIntervalText(raw);
}

function raceFields(formData: FormData) {
  const name = String(formData.get("name") ?? formData.get("race_name") ?? "").trim();
  const distance = Number(formData.get("distance_km"));
  const raceDate = String(formData.get("race_date") ?? "");
  if (!name || !Number.isFinite(distance) || distance <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(raceDate)) {
    return null;
  }
  const rawPriority = String(formData.get("priority") ?? "A").toUpperCase();
  const priority = rawPriority === "B" || rawPriority === "C" ? rawPriority : "A";
  // target_time as hh:mm:ss (preferred) — or the legacy target_time_minutes field.
  const legacyMinutes = String(formData.get("target_time_minutes") ?? "").trim();
  const target_time =
    toIntervalText(String(formData.get("target_time") ?? "")) ??
    (legacyMinutes ? toIntervalText(`${legacyMinutes} minutes`) : null);
  return { name, distance_km: distance, race_date: raceDate, priority, target_time };
}

/**
 * Adds a race. Fields: `name` (required), `distance_km` (required, > 0),
 * `race_date` (YYYY-MM-DD, required), `priority` (A|B|C, default A),
 * `target_time` (optional, hh:mm:ss).
 */
export async function addRace(formData: FormData) {
  const fields = raceFields(formData);
  if (!fields) return;
  const supabase = createServiceClient();
  await supabase.from("races").insert(fields);
  await refreshSeasonPlan();
  revalidateRaces();
}

/** Edits a race. Fields: `id` plus the addRace fields (all resupplied). */
export async function updateRace(formData: FormData) {
  const id = formId(formData);
  const fields = raceFields(formData);
  if (id === null || !fields) return;
  const supabase = createServiceClient();
  await supabase.from("races").update(fields).eq("id", id);
  await refreshSeasonPlan();
  revalidateRaces();
}

/** Deletes a race (confirm in the UI first). Field: `id`. */
export async function deleteRace(formData: FormData) {
  const id = formId(formData);
  if (id === null) return;
  const supabase = createServiceClient();
  // Season rows referencing it lose the pointer; the refresh recomputes them.
  await supabase.from("season_plan").update({ race_id: null }).eq("race_id", id);
  await supabase.from("season_plan").update({ race_in_week_id: null }).eq("race_in_week_id", id);
  await supabase.from("races").delete().eq("id", id);
  await refreshSeasonPlan();
  revalidateRaces();
}

/**
 * Sets a season week's running-volume band by hand (docs/SEASON-PLAN.md).
 * Fields: `week_start_date` (Monday, YYYY-MM-DD), `volume_low_km`,
 * `volume_high_km`. The band is kept verbatim through refreshes; when the
 * week is the one being planned, the whole curve re-seeds from it. Pass
 * `clear=1` to drop the override and let the planner derive the week again.
 */
export async function setWeekVolume(formData: FormData) {
  const week = String(formData.get("week_start_date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return;
  const supabase = createServiceClient();
  if (String(formData.get("clear") ?? "") === "1") {
    await supabase.from("season_plan").update({ volume_override: false }).eq("week_start_date", week);
  } else {
    const low = Number(formData.get("volume_low_km"));
    const high = Number(formData.get("volume_high_km"));
    if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high < low) return;
    await supabase
      .from("season_plan")
      .update({ volume_low_km: low, volume_high_km: high, volume_override: true })
      .eq("week_start_date", week);
  }
  await refreshSeasonPlan();
  revalidateRaces();
}

/**
 * Records how a race went. Fields: `id`, `result_time` (hh:mm:ss; empty
 * clears), `result_notes` (free text; empty clears).
 */
export async function recordRaceResult(formData: FormData) {
  const id = formId(formData);
  if (id === null) return;
  const supabase = createServiceClient();
  await supabase
    .from("races")
    .update({
      result_time: toIntervalText(String(formData.get("result_time") ?? "")),
      result_notes: String(formData.get("result_notes") ?? "").trim() || null,
    })
    .eq("id", id);
  await refreshSeasonPlan();
  revalidateRaces();
}

/**
 * @deprecated v3 — the single race goal is replaced by the `races` list
 * (addRace/updateRace/deleteRace). Kept compiling for the legacy Settings form
 * until the designer's Races UI lands; it mirrors the goal into `races` as the
 * priority-A race so the season planner keeps working meanwhile.
 */
export async function saveRaceGoal(formData: FormData) {
  const supabase = createServiceClient();

  const targetTimeMinutes = formData.get("target_time_minutes");
  const raceName = formData.get("race_name") as string;
  const raceDate = formData.get("race_date") as string;
  const distanceKm = Number(formData.get("distance_km"));

  // Replace the previously mirrored race (matched by the old goal's name+date).
  const { data: previous } = await supabase.from("race_goal").select("*").eq("id", true).maybeSingle();
  if (previous) {
    await supabase
      .from("races")
      .delete()
      .eq("name", previous.race_name)
      .eq("race_date", previous.race_date);
  }

  await supabase.from("race_goal").upsert({
    id: true,
    race_name: raceName,
    distance_km: distanceKm,
    race_date: raceDate,
    target_time: targetTimeMinutes ? `${targetTimeMinutes} minutes` : null,
  });
  await supabase.from("races").insert({
    name: raceName,
    distance_km: distanceKm,
    race_date: raceDate,
    priority: "A",
    target_time: targetTimeMinutes ? toIntervalText(`${targetTimeMinutes} minutes`) : null,
  });

  await refreshSeasonPlan();
  revalidateRaces();
}

/**
 * @deprecated v3 — use deleteRace. Removes the legacy goal and its mirrored
 * `races` row; the app then plans for general fitness.
 */
export async function clearRaceGoal() {
  const supabase = createServiceClient();
  const { data: previous } = await supabase.from("race_goal").select("*").eq("id", true).maybeSingle();
  if (previous) {
    await supabase
      .from("races")
      .delete()
      .eq("name", previous.race_name)
      .eq("race_date", previous.race_date);
  }
  await supabase.from("race_goal").delete().eq("id", true);
  await refreshSeasonPlan();
  revalidateRaces();
}

/** Deletes the stored OAuth token for a provider (confirmed in the UI first). */
export async function disconnectProvider(formData: FormData) {
  const provider = formData.get("provider");
  if (provider !== "strava" && provider !== "microsoft") return;
  const supabase = createServiceClient();
  await supabase.from("oauth_tokens").delete().eq("provider", provider);
  revalidatePath("/settings");
  revalidatePath("/");
}

// ---------------------------------------------------------------------------
// Context & feedback (fix round 1, U4) — write side. Interface contract in
// docs/DESIGN.md §8. Plain free-text upserts, so a future voice-transcript
// flow (roadmap: ElevenLabs capture) can populate the same rows unchanged.
// ---------------------------------------------------------------------------

/**
 * Saves the persistent "current injuries / niggles" free text (singleton row).
 * Field: `injuries`. An empty string clears it — the planner then reports
 * "none". The value stays until edited or cleared.
 */
export async function saveInjuries(formData: FormData) {
  const injuries = String(formData.get("injuries") ?? "").trim();
  const supabase = createServiceClient();
  await supabase.from("runner_context").upsert({
    id: true,
    injuries,
    updated_at: new Date().toISOString(),
  });
  revalidatePath("/settings");
  revalidatePath("/");
}

/**
 * Saves the weekly feedback note. Fields: `feedback` (free text) and
 * `week_start_date` (YYYY-MM-DD Monday; optional — defaults to the Monday of
 * the current London week, i.e. the week the note describes). Upserting the
 * same week overwrites, so the note stays editable until the next week's
 * plan generates and the key moves on. An empty note deletes the row.
 */
export async function saveWeeklyFeedback(formData: FormData) {
  const feedback = String(formData.get("feedback") ?? "").trim();
  const raw = String(formData.get("week_start_date") ?? "");
  const week = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? mondayOf(raw) : mondayOf(todayISO());

  const supabase = createServiceClient();
  if (feedback === "") {
    await supabase.from("weekly_feedback").delete().eq("week_start_date", week);
  } else {
    await supabase.from("weekly_feedback").upsert({
      week_start_date: week,
      feedback,
      updated_at: new Date().toISOString(),
    });
  }
  revalidatePath("/settings");
  revalidatePath("/");
}

// ---------------------------------------------------------------------------
// Injury history (round 2, U5) — write side. Interface contract in
// docs/DESIGN.md §8b. Free text throughout (voice-transcript-friendly).
// ---------------------------------------------------------------------------

function formId(formData: FormData): number | null {
  const id = Number(formData.get("id"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Adds a past injury. Fields: `description` (required), `period` (optional free text). */
export async function addInjuryHistory(formData: FormData) {
  const description = String(formData.get("description") ?? "").trim();
  if (!description) return;
  const period = String(formData.get("period") ?? "").trim();
  const supabase = createServiceClient();
  await supabase.from("injury_history").insert({ description, period });
  revalidatePath("/checkin");
  revalidatePath("/");
}

/** Edits a past injury. Fields: `id`, `description` (required), `period`. */
export async function updateInjuryHistory(formData: FormData) {
  const id = formId(formData);
  const description = String(formData.get("description") ?? "").trim();
  if (id === null || !description) return;
  const period = String(formData.get("period") ?? "").trim();
  const supabase = createServiceClient();
  await supabase.from("injury_history").update({ description, period }).eq("id", id);
  revalidatePath("/checkin");
  revalidatePath("/");
}

/** Deletes a past injury. Field: `id`. */
export async function deleteInjuryHistory(formData: FormData) {
  const id = formId(formData);
  if (id === null) return;
  const supabase = createServiceClient();
  await supabase.from("injury_history").delete().eq("id", id);
  revalidatePath("/checkin");
  revalidatePath("/");
}

// ---------------------------------------------------------------------------
// Manually logged sessions (round 2, U6) — write side. Interface contract in
// docs/DESIGN.md §8b.
// ---------------------------------------------------------------------------

function manualActivityFields(formData: FormData) {
  const type = String(formData.get("type") ?? "").trim();
  const duration = Math.round(Number(formData.get("duration_min")));
  if (!type || !Number.isFinite(duration) || duration <= 0) return null;

  const rawDate = String(formData.get("activity_date") ?? "");
  const activity_date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : todayISO();

  const rawDistance = String(formData.get("distance_km") ?? "").trim();
  const parsedDistance = rawDistance === "" ? NaN : Number(rawDistance);
  const distance_km = Number.isFinite(parsedDistance) && parsedDistance > 0 ? parsedDistance : null;

  const note = String(formData.get("note") ?? "").trim() || null;
  return { activity_date, type, duration_min: duration, distance_km, note };
}

/**
 * Logs a session that never reached Strava. Fields: `type` (required — a plan
 * session type or free text), `duration_min` (required, minutes),
 * `activity_date` (optional YYYY-MM-DD, defaults to today in London),
 * `distance_km` (optional — run types with a distance count as running km),
 * `note` (optional).
 */
export async function addManualActivity(formData: FormData) {
  const fields = manualActivityFields(formData);
  if (!fields) return;
  const supabase = createServiceClient();
  await supabase.from("manual_activities").insert(fields);
  revalidatePath("/activities");
  revalidatePath("/");
  revalidatePath("/plan");
}

/** Edits a logged session. Fields: `id` plus the addManualActivity fields. */
export async function updateManualActivity(formData: FormData) {
  const id = formId(formData);
  const fields = manualActivityFields(formData);
  if (id === null || !fields) return;
  const supabase = createServiceClient();
  await supabase.from("manual_activities").update(fields).eq("id", id);
  revalidatePath("/activities");
  revalidatePath("/");
  revalidatePath("/plan");
}

/** Deletes a logged session. Field: `id`. */
export async function deleteManualActivity(formData: FormData) {
  const id = formId(formData);
  if (id === null) return;
  const supabase = createServiceClient();
  await supabase.from("manual_activities").delete().eq("id", id);
  revalidatePath("/activities");
  revalidatePath("/");
  revalidatePath("/plan");
}

// ---------------------------------------------------------------------------
// Pending plan changes (V2, REDESIGN-V2.md §Screen 2) — write side. Interface
// contract in docs/DESIGN.md §8d. Changes accumulate here and NOTHING
// regenerates until POST /api/plan/generate { apply_pending: true } fires one
// batched revision. Cleared on successful apply only.
// ---------------------------------------------------------------------------

function pendingWeek(formData: FormData): string {
  const raw = String(formData.get("week_start_date") ?? "");
  // The edit mode always targets the plan (boundary) week.
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? mondayOf(raw) : boundaryWeekStart(new Date());
}

async function readPendingChanges(week: string): Promise<unknown[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("pending_changes")
    .select("changes")
    .eq("week_start_date", week)
    .maybeSingle();
  return Array.isArray(data?.changes) ? (data.changes as unknown[]) : [];
}

/**
 * Queues one change request. Fields: `date` (optional YYYY-MM-DD — omit for a
 * general instruction), `requested_type` (optional plan session type) and/or
 * `instruction` (optional free text) — at least one of the last two required;
 * `week_start_date` optional (defaults to the plan week).
 */
export async function addPendingChange(formData: FormData) {
  const requestedType = String(formData.get("requested_type") ?? "").trim() || null;
  const instruction = String(formData.get("instruction") ?? "").trim() || null;
  if (!requestedType && !instruction) return;
  const rawDate = String(formData.get("date") ?? "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;

  const week = pendingWeek(formData);
  const changes = await readPendingChanges(week);
  changes.push({ id: crypto.randomUUID(), date, requested_type: requestedType, instruction });

  const supabase = createServiceClient();
  await supabase.from("pending_changes").upsert({
    week_start_date: week,
    changes,
    updated_at: new Date().toISOString(),
  });
  revalidatePath("/plan");
}

/** Removes one queued change. Fields: `id` (the change's uuid), optional `week_start_date`. */
export async function removePendingChange(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const week = pendingWeek(formData);
  const changes = (await readPendingChanges(week)).filter(
    (c) => !(typeof c === "object" && c !== null && (c as Record<string, unknown>).id === id)
  );
  const supabase = createServiceClient();
  await supabase.from("pending_changes").upsert({
    week_start_date: week,
    changes,
    updated_at: new Date().toISOString(),
  });
  revalidatePath("/plan");
}

/** Clears the week's queued changes and inline check-in note. Optional `week_start_date`. */
export async function clearPendingChanges(formData: FormData) {
  const week = pendingWeek(formData);
  const supabase = createServiceClient();
  await supabase.from("pending_changes").delete().eq("week_start_date", week);
  revalidatePath("/plan");
}

/**
 * Saves the edit mode's inline check-in note (persisted with the pending
 * changes; written to weekly_feedback when the batch is applied). Fields:
 * `checkin_note` (may be empty to clear), optional `week_start_date`.
 */
export async function savePendingCheckin(formData: FormData) {
  const week = pendingWeek(formData);
  const checkinNote = String(formData.get("checkin_note") ?? "").trim();
  const supabase = createServiceClient();
  // Partial upsert: only the provided columns update, so queued changes
  // survive (a fresh insert gets the empty-array default).
  await supabase.from("pending_changes").upsert({
    week_start_date: week,
    checkin_note: checkinNote,
    updated_at: new Date().toISOString(),
  });
  revalidatePath("/plan");
}
