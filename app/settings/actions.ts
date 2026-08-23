"use server";

import { createServiceClient } from "@/lib/supabase/service";
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
