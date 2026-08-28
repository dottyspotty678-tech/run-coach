import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import { getTrainingPhase } from "@/lib/trainingPhase";
import { isStravaConnected } from "@/lib/strava";
import { isMicrosoftConnected } from "@/lib/microsoft";
import { relativeTime, todayISO } from "@/components/dates";
import { getSyncStatus } from "@/components/data";
import { IconChevronRight } from "@/components/icons";
import { RaceForm } from "./race-form";
import { FoodForm } from "./food-form";
import { Connections } from "./connections";
import pkg from "@/package.json";

// Reads the DB on every request — without this, Next prerenders the page at
// build time and serves stale form prefills.
export const dynamic = "force-dynamic";

const PHASE_LABEL: Record<string, string> = {
  base: "Base",
  build: "Build",
  peak: "Peak",
  taper: "Taper",
  race_week: "Race week",
  post_race: "Post-race",
};

export default async function SettingsPage() {
  const now = new Date();
  const supabase = createServiceClient();

  const [
    { data: settings },
    { data: raceGoal },
    stravaConnected,
    microsoftConnected,
    syncStatus,
  ] = await Promise.all([
    supabase.from("settings").select("*").eq("id", true).maybeSingle(),
    supabase.from("race_goal").select("*").eq("id", true).maybeSingle(),
    isStravaConnected(),
    isMicrosoftConnected(),
    getSyncStatus(),
  ]);

  const phaseInfo = raceGoal
    ? getTrainingPhase(new Date(raceGoal.race_date), raceGoal.distance_km, now)
    : null;

  return (
    <main className="flex flex-col gap-6 px-4 pt-3">
      <header className="pt-1">
        <h1 className="text-[22px] font-semibold leading-7">Settings</h1>
      </header>

      {/* 1. Race goal (id: deep-link target for the Dashboard quick action) */}
      <section id="race" className="flex flex-col gap-3">
        <h2 className="overline" style={{ color: "var(--ink-2)" }}>
          Race goal
        </h2>
        <div className="card p-4">
          <RaceForm
            defaults={
              raceGoal
                ? {
                    race_name: raceGoal.race_name,
                    distance_km: raceGoal.distance_km,
                    race_date: raceGoal.race_date,
                    target_time: raceGoal.target_time,
                  }
                : null
            }
            todayIso={todayISO(now)}
          />
        </div>
        {phaseInfo && (
          <div
            className="card flex items-baseline gap-2 p-4"
            style={{ background: "var(--accent-soft)", borderColor: "transparent" }}
          >
            <span className="text-[17px] font-semibold" style={{ color: "var(--accent)" }}>
              {PHASE_LABEL[phaseInfo.phase] ?? phaseInfo.phase}
            </span>
            <span className="text-[13px]" style={{ color: "var(--ink-2)" }}>
              {phaseInfo.phase === "post_race"
                ? "Race day has passed — recovery first, then set the next goal."
                : phaseInfo.weeksToRace >= 1
                  ? `${Math.round(phaseInfo.weeksToRace)} weeks to race day`
                  : "Race day is this week"}
            </span>
          </div>
        )}
      </section>

      {/* 2. Food preferences */}
      <section className="flex flex-col gap-3">
        <h2 className="overline" style={{ color: "var(--ink-2)" }}>
          Food preferences
        </h2>
        <div className="card p-4">
          <FoodForm
            defaults={{
              weight_goal: settings?.weight_goal ?? "maintain",
              dietary_restrictions: settings?.dietary_restrictions ?? [],
              disliked_ingredients: settings?.disliked_ingredients ?? [],
              household_size: settings?.household_size ?? 1,
            }}
          />
        </div>
      </section>

      {/* 3. Connections */}
      <section id="connections" className="flex flex-col gap-3">
        <h2 className="overline" style={{ color: "var(--ink-2)" }}>
          Connections
        </h2>
        <Connections
          strava={{
            connected: stravaConnected,
            lastSync: relativeTime(syncStatus.strava?.last_synced_at, now),
            // Omit the prop entirely on a clean sync (cos-1) — see connections.tsx.
            ...(syncStatus.strava?.last_error ? { issue: syncStatus.strava.last_error } : {}),
          }}
          microsoft={{
            connected: microsoftConnected,
            lastSync: relativeTime(syncStatus.microsoft?.last_synced_at, now),
            ...(syncStatus.microsoft?.last_error
              ? { issue: syncStatus.microsoft.last_error }
              : {}),
          }}
        />
      </section>

      {/* Context & feedback lives on its own screen (/checkin); this row keeps
          it reachable from Settings too (§3.11). */}
      <Link href="/checkin" className="card flex min-h-[56px] items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Check-in</span>
          <span className="block text-[13px]" style={{ color: "var(--ink-2)" }}>
            Injuries and weekly feedback for the planner
          </span>
        </span>
        <IconChevronRight size={16} strokeWidth={2.2} className="shrink-0" style={{ color: "var(--ink-3)" }} />
      </Link>

      <footer className="pb-2 text-center text-[12px]" style={{ color: "var(--ink-3)" }}>
        Run Coach v{pkg.version} · PIN protected — change the PIN via the server configuration
      </footer>
    </main>
  );
}
