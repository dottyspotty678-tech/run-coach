"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { mondayOf, todayISO } from "@/components/dates";
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

export async function saveRaceGoal(formData: FormData) {
  const supabase = createServiceClient();

  const targetTimeMinutes = formData.get("target_time_minutes");

  await supabase.from("race_goal").upsert({
    id: true,
    race_name: formData.get("race_name") as string,
    distance_km: Number(formData.get("distance_km")),
    race_date: formData.get("race_date") as string,
    target_time: targetTimeMinutes ? `${targetTimeMinutes} minutes` : null,
  });

  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/plan");
}

/** Removes the race goal — the app then plans for general fitness. */
export async function clearRaceGoal() {
  const supabase = createServiceClient();
  await supabase.from("race_goal").delete().eq("id", true);
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/plan");
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
