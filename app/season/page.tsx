import Link from "next/link";
import { findCloseARaces, weeksUntil } from "@/lib/season";
import { boundaryWeekStart, formatDateShort, mondayOf, todayISO } from "@/components/dates";
import { getRaces, getSeasonPlan } from "@/components/data";
import { Banner } from "@/components/banner";
import { IconChevronLeft, IconChevronRight } from "@/components/icons";
import {
  BLOCK_SHORT,
  PHASE_META,
  PhaseChip,
  RaceMarker,
  STABILITY_TONE,
  volumeBand,
} from "@/components/season-ui";

// Reads the DB on every request — never serve a stale prerender.
export const dynamic = "force-dynamic";

const HORIZON_WEEKS = 35;

/**
 * Season screen (docs/SEASON-PLAN.md §6): read-only, one row per week for the
 * 35-week horizon. Secondary screen off the Plan tab. Stability shows as tone
 * (pinned solid, firm normal, fuzzy dimmed); the current week is ringed.
 */
export default async function SeasonPage() {
  const now = new Date();
  const today = todayISO(now);
  const currentWeek = mondayOf(today);
  const fromWeek = boundaryWeekStart(now);

  const [rows, races] = await Promise.all([getSeasonPlan(fromWeek, HORIZON_WEEKS), getRaces()]);
  const raceById = new Map(races.map((r) => [r.id, r]));
  const closePairs = findCloseARaces(races);

  return (
    <main className="flex flex-col gap-4 px-4 pt-3">
      {/* Secondary screen: back affordance to Plan */}
      <header className="flex items-center gap-1 pt-1">
        <Link
          href="/plan"
          aria-label="Back to Plan"
          className="-ml-2 flex min-h-[44px] min-w-[44px] items-center justify-center"
          style={{ color: "var(--accent)" }}
        >
          <IconChevronLeft size={22} strokeWidth={2.2} />
        </Link>
        <h1 className="display text-[26px] leading-8">Season</h1>
        <Link
          href="/settings#races"
          className="ml-auto flex min-h-[44px] items-center gap-0.5 text-[13px] font-semibold"
          style={{ color: "var(--accent)" }}
        >
          Races
          <IconChevronRight size={14} strokeWidth={2.4} />
        </Link>
      </header>

      {/* Two A races within 6 weeks — the planner keeps both but flags them. */}
      {closePairs.map(([first, second]) => (
        <Banner key={`${first.id}-${second.id}`} quiet variant="warn" href="/settings#races" linkLabel="Races">
          {first.name} and {second.name} are {weeksUntil(first.race_date, second.race_date)} weeks apart —
          the second is treated as a second peak
        </Banner>
      ))}

      {races.length === 0 && (
        <Link href="/settings#races" className="card flex items-center gap-3 p-4">
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">General fitness blocks</span>
            <span className="block text-[13px]" style={{ color: "var(--ink-2)" }}>
              Add a race to shape the season
            </span>
          </span>
          <IconChevronRight size={16} strokeWidth={2.2} className="shrink-0" style={{ color: "var(--ink-3)" }} />
        </Link>
      )}

      {rows.length === 0 ? (
        races.length > 0 && (
          <p className="card p-4 text-[13px]" style={{ color: "var(--ink-2)" }}>
            Season plan not built yet — it arrives with the next plan generation.
          </p>
        )
      ) : (
        <section className="flex flex-col gap-2">
          {/* One-line legend: stability by tone */}
          <div className="flex items-center gap-3 px-1 text-[11px]" style={{ color: "var(--ink-3)" }}>
            {(["pinned", "firm", "fuzzy"] as const).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: "var(--ink)", opacity: STABILITY_TONE[s].opacity }}
                  aria-hidden="true"
                />
                {STABILITY_TONE[s].label}
              </span>
            ))}
            <span className="ml-auto flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ boxShadow: "0 0 0 2px var(--accent)", background: "var(--surface)" }}
                aria-hidden="true"
              />
              This week
            </span>
          </div>

          <div className="card overflow-hidden">
            <div
              className="grid grid-cols-[52px_1fr_44px_62px] items-center gap-2 border-b px-3 py-2"
              style={{ borderColor: "var(--line)" }}
            >
              <span className="overline" style={{ color: "var(--ink-3)" }}>W/c</span>
              <span className="overline" style={{ color: "var(--ink-3)" }}>Phase</span>
              <span className="overline" style={{ color: "var(--ink-3)" }}>Block</span>
              <span className="overline text-right" style={{ color: "var(--ink-3)" }}>Volume</span>
            </div>
            <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
              {rows.map((row) => {
                const isCurrent = row.week_start_date === currentWeek;
                const raceInWeek = row.race_in_week_id ? raceById.get(row.race_in_week_id) ?? null : null;
                const tone = STABILITY_TONE[row.stability];
                const phaseColor = PHASE_META[row.phase].color;
                return (
                  <li
                    key={row.week_start_date}
                    className="flex flex-col gap-1.5 px-3 py-2.5"
                    style={{ borderColor: "var(--line)", opacity: isCurrent ? 1 : tone.opacity }}
                    aria-current={isCurrent ? "date" : undefined}
                  >
                    <div className="grid grid-cols-[52px_1fr_44px_62px] items-center gap-2">
                      <span className="flex items-center gap-1.5">
                        {/* Waymark disc in the phase colour; today's week ringed in accent. */}
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            background: phaseColor,
                            boxShadow: isCurrent ? "0 0 0 2px var(--accent)" : undefined,
                          }}
                          aria-hidden="true"
                        />
                        <span
                          className="tabular text-[12px] font-semibold"
                          style={{ color: isCurrent ? "var(--accent)" : "var(--ink-2)" }}
                        >
                          {formatDateShort(row.week_start_date)}
                        </span>
                      </span>
                      <span className="min-w-0">
                        <PhaseChip phase={row.phase} />
                      </span>
                      <span className="tabular text-[12px] font-semibold" style={{ color: "var(--ink-2)" }}>
                        {BLOCK_SHORT[row.block_position]}
                      </span>
                      <span className="tabular text-right text-[12px] font-semibold">
                        {volumeBand(row)}
                      </span>
                    </div>
                    {raceInWeek && (
                      <div className="pl-[22px]">
                        <RaceMarker race={raceInWeek} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}
