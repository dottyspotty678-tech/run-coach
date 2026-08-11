import { createServiceClient } from "@/lib/supabase/service";
import { getTrainingPhase } from "@/lib/trainingPhase";
import Link from "next/link";
import { saveSettings, saveRaceGoal } from "./actions";

export default async function SettingsPage() {
  const supabase = createServiceClient();

  const [{ data: settings }, { data: raceGoal }] = await Promise.all([
    supabase.from("settings").select("*").eq("id", true).maybeSingle(),
    supabase.from("race_goal").select("*").eq("id", true).maybeSingle(),
  ]);

  const phaseInfo = raceGoal
    ? getTrainingPhase(new Date(raceGoal.race_date), raceGoal.distance_km)
    : null;

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-8 p-6">
      <Link href="/" className="text-sm opacity-70">
        &larr; Back
      </Link>

      <section className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Target race</h1>
        {phaseInfo && (
          <p className="rounded bg-black/5 p-2 text-sm dark:bg-white/10">
            Current phase: <strong>{phaseInfo.phase}</strong> (
            {phaseInfo.weeksToRace.toFixed(1)} weeks to go)
          </p>
        )}
        <form action={saveRaceGoal} className="flex flex-col gap-2">
          <input
            name="race_name"
            defaultValue={raceGoal?.race_name ?? ""}
            placeholder="Race name"
            required
            className="rounded border border-black/20 px-3 py-2 dark:border-white/20"
          />
          <input
            name="distance_km"
            type="number"
            step="0.1"
            defaultValue={raceGoal?.distance_km ?? ""}
            placeholder="Distance (km)"
            required
            className="rounded border border-black/20 px-3 py-2 dark:border-white/20"
          />
          <input
            name="race_date"
            type="date"
            defaultValue={raceGoal?.race_date ?? ""}
            required
            className="rounded border border-black/20 px-3 py-2 dark:border-white/20"
          />
          <input
            name="target_time_minutes"
            type="number"
            placeholder="Target finish time (minutes, optional)"
            className="rounded border border-black/20 px-3 py-2 dark:border-white/20"
          />
          <button type="submit" className="rounded bg-black px-3 py-2 text-white dark:bg-white dark:text-black">
            Save race goal
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Settings</h1>
        <form action={saveSettings} className="flex flex-col gap-2">
          <label className="text-sm opacity-70">Weight goal</label>
          <select
            name="weight_goal"
            defaultValue={settings?.weight_goal ?? "maintain"}
            className="rounded border border-black/20 px-3 py-2 dark:border-white/20"
          >
            <option value="maintain">Maintain</option>
            <option value="lose">Lose</option>
          </select>

          <label className="text-sm opacity-70">Dietary restrictions (comma-separated)</label>
          <input
            name="dietary_restrictions"
            defaultValue={(settings?.dietary_restrictions ?? []).join(", ")}
            placeholder="e.g. vegetarian, no shellfish"
            className="rounded border border-black/20 px-3 py-2 dark:border-white/20"
          />

          <label className="text-sm opacity-70">Disliked ingredients (comma-separated)</label>
          <input
            name="disliked_ingredients"
            defaultValue={(settings?.disliked_ingredients ?? []).join(", ")}
            placeholder="e.g. mushrooms, olives"
            className="rounded border border-black/20 px-3 py-2 dark:border-white/20"
          />

          <label className="text-sm opacity-70">Household size</label>
          <input
            name="household_size"
            type="number"
            min="1"
            defaultValue={settings?.household_size ?? 1}
            className="rounded border border-black/20 px-3 py-2 dark:border-white/20"
          />

          <button type="submit" className="rounded bg-black px-3 py-2 text-white dark:bg-white dark:text-black">
            Save settings
          </button>
        </form>
      </section>
    </main>
  );
}
