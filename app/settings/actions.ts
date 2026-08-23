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
