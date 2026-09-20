import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import { PHASE_LABELS, blockLabel, weeksUntil } from "@/lib/season";
import { isStravaConnected } from "@/lib/strava";
import { isMicrosoftConnected } from "@/lib/microsoft";
import { boundaryWeekStart, mondayOf, relativeTime, todayISO } from "@/components/dates";
import { getNextRaces, getRaces, getSeasonWeek, getSyncStatus, getWatchSync } from "@/components/data";
import { isIntervalsConfigured } from "@/lib/intervals";
import { WatchCard } from "@/components/watch-sync";
import { IconChevronRight } from "@/components/icons";
import { Races } from "./races";
import { FoodForm } from "./food-form";
import { Connections } from "./connections";
import pkg from "@/package.json";

// Reads the DB on every request — without this, Next prerenders the page at
// build time and serves stale form prefills.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const now = new Date();
  const today = todayISO(now);
  const supabase = createServiceClient();

  const [
    { data: settings },
    races,
    stravaConnected,
    microsoftConnected,
    syncStatus,
    seasonRow,
    nextRaces,
    watchRow,
  ] = await Promise.all([
    supabase.from("settings").select("*").eq("id", true).maybeSingle(),
    // v3: the races list replaces the legacy single race_goal form.
    getRaces(),
    isStravaConnected(),
    isMicrosoftConnected(),
    getSyncStatus(),
    // v3: the phase card reads this week's season row + the next race.
    getSeasonWeek(mondayOf(today)),
    getNextRaces(today, 1),
    // Watch sync (§8f): the current plan (boundary) week's push status.
    getWatchSync(boundaryWeekStart(now)),
  ]);
  const nextRace = nextRaces[0] ?? null;
  const weeksToRace = nextRace ? weeksUntil(mondayOf(today), nextRace.race_date) : null;

  return (
    <main className="flex flex-col gap-6 px-4 pt-3">
      <header className="pt-1">
        <h1 className="display text-[26px] leading-8">Settings</h1>
      </header>

      {/* 1. Races (id: deep-link target for the Dashboard quick action) */}
      <section id="races" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="overline" style={{ color: "var(--ink-2)" }}>
            Races
          </h2>
          <Link
            href="/season"
            className="flex min-h-[44px] items-center gap-0.5 text-[13px] font-semibold"
            style={{ color: "var(--accent)" }}
          >
            Season
            <IconChevronRight size={14} strokeWidth={2.4} />
          </Link>
        </div>
        <Races
          races={races.map((r) => ({
            id: r.id,
            name: r.name,
            distance_km: r.distance_km,
            race_date: r.race_date,
            priority: r.priority,
            target_time: r.target_time,
            result_time: r.result_time,
            result_notes: r.result_notes,
          }))}
          todayIso={today}
        />
        {seasonRow && (
          <div
            className="card flex items-baseline gap-2 p-4"
            style={{ background: "var(--accent-soft)", borderColor: "transparent" }}
          >
            <span className="display text-[20px]" style={{ color: "var(--accent)" }}>
              {PHASE_LABELS[seasonRow.phase]}
            </span>
            <span className="text-[13px]" style={{ color: "var(--ink-2)" }}>
              {seasonRow.phase === "recovery"
                ? "Race done — recovery first, then the next block."
                : nextRace && weeksToRace !== null
                  ? weeksToRace >= 1
                    ? `${blockLabel(seasonRow)} · ${weeksToRace} weeks to ${nextRace.name}`
                    : `${nextRace.name} is this week`
                  : `${blockLabel(seasonRow)} · no race scheduled`}
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
        <WatchCard
          configured={isIntervalsConfigured()}
          weekStart={boundaryWeekStart(now)}
          pushedRelative={relativeTime(watchRow?.pushed_at, now)}
          eventsPushed={watchRow?.events_pushed ?? 0}
          {...(watchRow?.last_error ? { issue: watchRow.last_error } : {})}
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
