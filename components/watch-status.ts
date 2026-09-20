import type { TrainingDay } from "@/lib/planTypes";
import type { WatchSyncRow } from "@/components/data";
import type { WatchStatus } from "@/components/watch-sync";
import { relativeTime } from "@/components/dates";

// Server-side status derivation for the watch-sync line (DESIGN.md §8f):
// null row → never; last_error set → issue; pushed_at set → on watch. The
// "3 runs, 2 gym" breakdown counts the plan's session types (runs = easy /
// tempo / intervals / long / race, gym = strength) — not the row's total.

const RUN_TYPES = new Set(["easy", "tempo", "intervals", "long", "race"]);

export function watchBreakdown(days: TrainingDay[] | null): string {
  let runs = 0;
  let gym = 0;
  for (const d of days ?? []) {
    if (RUN_TYPES.has(d.session_type)) runs += 1;
    else if (d.session_type === "strength") gym += 1;
  }
  const parts: string[] = [];
  if (runs > 0) parts.push(`${runs} run${runs === 1 ? "" : "s"}`);
  if (gym > 0) parts.push(`${gym} gym`);
  return parts.length > 0 ? parts.join(", ") : "no workouts";
}

export function watchStatusFor(
  row: WatchSyncRow | null,
  days: TrainingDay[] | null,
  now: Date
): WatchStatus {
  if (!row) return { kind: "never" };
  if (row.last_error) {
    return { kind: "issue", text: row.last_error, lastGoodRelative: relativeTime(row.pushed_at, now) };
  }
  if (row.pushed_at) {
    return {
      kind: "ok",
      breakdown: watchBreakdown(days),
      syncedRelative: relativeTime(row.pushed_at, now) ?? "just now",
    };
  }
  return { kind: "never" };
}
