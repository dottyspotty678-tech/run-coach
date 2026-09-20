import type { BlockPosition, SeasonPhase, SeasonWeek, Stability } from "@/lib/season";
import { PHASE_LABELS, blockLabel, weeksUntil } from "@/lib/season";
import type { RaceRow } from "@/components/data";
import { PriorityChip } from "@/app/settings/races";

// V3 season presentation (docs/SEASON-PLAN.md §6, DESIGN.md §8e). Phase
// colours reuse the fixed session-type tokens so the Season screen, the Plan
// position line and the Settings phase card read as one system: a phase is
// coloured like the session that defines it.

export const PHASE_META: Record<SeasonPhase, { color: string; soft: string }> = {
  base: { color: "var(--s-easy)", soft: "var(--s-easy-soft)" },
  build: { color: "var(--s-long)", soft: "var(--s-long-soft)" },
  peak: { color: "var(--s-intervals)", soft: "var(--s-intervals-soft)" },
  taper: { color: "var(--s-tempo)", soft: "var(--s-tempo-soft)" },
  race_week: { color: "var(--s-race)", soft: "var(--s-race-soft)" },
  recovery: { color: "var(--s-rest)", soft: "var(--s-rest-soft)" },
  general: { color: "var(--s-strength)", soft: "var(--s-strength-soft)" },
};

/** Short block-position label for table cells: "1/3", "Down", "Taper", "Race", "Recovery". */
export const BLOCK_SHORT: Record<BlockPosition, string> = {
  "1": "1/3",
  "2": "2/3",
  "3": "3/3",
  down: "Down",
  taper: "Taper",
  race: "Race",
  recovery: "Recovery",
};

/** Stability → tone. Pinned solid, firm normal, fuzzy dimmed (SEASON-PLAN §4). */
export const STABILITY_TONE: Record<Stability, { opacity: number; label: string }> = {
  pinned: { opacity: 1, label: "Pinned" },
  firm: { opacity: 0.85, label: "Firm" },
  fuzzy: { opacity: 0.55, label: "Fuzzy" },
};

export function PhaseChip({ phase }: { phase: SeasonPhase }) {
  const meta = PHASE_META[phase];
  return (
    <span className="chip" style={{ color: meta.color, background: meta.soft }}>
      {PHASE_LABELS[phase]}
    </span>
  );
}

/** "48–58 km" from a season row's band. */
export function volumeBand(row: Pick<SeasonWeek, "volume_low_km" | "volume_high_km">): string {
  return `${Math.round(row.volume_low_km)}–${Math.round(row.volume_high_km)} km`;
}

/**
 * The race this week points at (row.race_id), else the soonest upcoming race
 * — and the countdown text: "9 weeks to Manchester Half" / "Manchester Half this week".
 */
export function raceCountdown(
  row: SeasonWeek | null,
  races: RaceRow[],
  fallback: RaceRow | null,
  weekStart: string
): { race: RaceRow; text: string } | null {
  const inWeek = row ? races.find((r) => r.id === row.race_in_week_id) ?? null : null;
  const pointing = row ? races.find((r) => r.id === row.race_id) ?? null : null;
  const race = inWeek ?? pointing ?? fallback;
  if (!race) return null;
  const weeks = weeksUntil(weekStart, race.race_date);
  if (weeks < 0) return null;
  const text =
    weeks === 0 ? `${race.name} this week` : `${weeks} week${weeks === 1 ? "" : "s"} to ${race.name}`;
  return { race, text };
}

/**
 * One-line season position for a week-summary card:
 * [Build] week 2 of 3 · 9 weeks to Manchester Half            48–58 km
 * Truncates the middle, never wraps — the band stays visible on the right.
 */
export function SeasonPosition({
  row,
  races,
  fallbackRace,
  weekStart,
}: {
  row: SeasonWeek | null;
  races: RaceRow[];
  fallbackRace: RaceRow | null;
  weekStart: string;
}) {
  if (!row) {
    const countdown = raceCountdown(null, races, fallbackRace, weekStart);
    return (
      <div className="flex min-w-0 items-center gap-2">
        <PhaseChip phase="general" />
        <span className="min-w-0 truncate text-[13px]" style={{ color: "var(--ink-2)" }}>
          {countdown ? countdown.text : "no season plan yet"}
        </span>
      </div>
    );
  }
  const countdown = raceCountdown(row, races, fallbackRace, weekStart);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <PhaseChip phase={row.phase} />
      <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: "var(--ink-2)" }}>
        {blockLabel(row)}
        {countdown ? ` · ${countdown.text}` : ""}
      </span>
      <span className="tabular shrink-0 text-[12px] font-semibold" style={{ color: "var(--ink-2)" }}>
        {volumeBand(row)}
      </span>
    </div>
  );
}

/** Race marker for a season row: name + priority chip. */
export function RaceMarker({ race }: { race: RaceRow }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <PriorityChip priority={race.priority} />
      <span className="min-w-0 truncate text-[13px] font-semibold">{race.name}</span>
    </span>
  );
}
