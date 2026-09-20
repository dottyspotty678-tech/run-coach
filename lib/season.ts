// Season planner (docs/SEASON-PLAN.md §3–§4): multi-race, right-to-left
// periodisation. PURE — no imports, no I/O — so it is unit-testable straight
// from Node (`node --test scripts/season.test.mts`). lib/seasonPlan.ts loads
// the inputs and stores the result; this file only computes.
//
// Vocabulary: a "week" is a Monday (YYYY-MM-DD, London calendar). Week index 0
// is the week containing `today`. The plan covers `weeks` (default 35) weeks
// forward — roughly the 8 months the spec asks for.

export type RacePriority = "A" | "B" | "C";
export type SeasonPhase = "base" | "build" | "peak" | "taper" | "race_week" | "recovery" | "general";
export type BlockPosition = "1" | "2" | "3" | "down" | "taper" | "race" | "recovery";
export type Stability = "pinned" | "firm" | "fuzzy";

export type SeasonRace = {
  id: number;
  name: string;
  distance_km: number;
  /** YYYY-MM-DD */
  race_date: string;
  priority: RacePriority;
  target_time?: string | null;
  result_time?: string | null;
};

export type SeasonWeek = {
  /** Monday, YYYY-MM-DD */
  week_start_date: string;
  phase: SeasonPhase;
  block_position: BlockPosition;
  volume_low_km: number;
  volume_high_km: number;
  focus: string;
  stability: Stability;
  /** The next A/B race this week points at, or null. */
  race_id: number | null;
  /** A race that falls inside this week (highest priority wins), or null. */
  race_in_week_id: number | null;
  /**
   * True when the runner set this week's band by hand. The band is kept
   * verbatim through every refresh (no hold, no clamp), and when it is the
   * planning week the whole volume curve re-seeds from it.
   */
  volume_override?: boolean;
};

export type SeasonInput = {
  races: SeasonRace[];
  /** Today, YYYY-MM-DD (London). Week 0 is the week containing it. */
  today: string;
  /** 4-week average weekly running km (falls back to last-7 when 0). */
  currentFitnessKm: number;
  /** Running km in the last 7 days — used for holds and the fallback. */
  last7Km: number;
  /** The weekly context's 10%-rule ceiling (last 7 + 10%), or null. */
  runningCeilingKm?: number | null;
  /** Previously stored rows (any weeks) — for the stability merge. */
  stored?: SeasonWeek[];
  /** Current rolling-7-day LOAD FLAG. */
  loadFlag?: boolean;
  /** Latest check-in reads as "too hard" / flat. */
  tooHardCheckin?: boolean;
  /** Week (Monday) a load-flag/too-hard hold applies to. Default: week 0. */
  holdWeek?: string;
  /**
   * Week (Monday) where 3:1 block counting starts — the week being planned.
   * Weeks before it are already lived. Stored rows for near weeks override
   * this so later refreshes continue the sequence rather than restarting it.
   */
  blockStartWeek?: string;
  /** Horizon in weeks. Default 35. */
  weeks?: number;
};

// ---------------------------------------------------------------------------
// Date arithmetic — duplicated from components/dates.ts on purpose so this
// module stays import-free (Node cannot resolve "@/…" aliases).
// ---------------------------------------------------------------------------

function isoFrom(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return isoFrom(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sunday … 6 Saturday
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// ---------------------------------------------------------------------------
// Distance tiers (lifted from the retired lib/trainingPhase.ts, numbers per
// SEASON-PLAN.md §3).
// ---------------------------------------------------------------------------

export type DistanceTier = "marathon" | "half" | "short";

export function distanceTier(km: number): DistanceTier {
  if (km >= 30) return "marathon";
  if (km >= 15) return "half";
  return "short";
}

export function taperWeeksFor(km: number): number {
  return { marathon: 3, half: 2, short: 1 }[distanceTier(km)];
}

export function peakWeeksFor(km: number): number {
  return { marathon: 3, half: 2, short: 1 }[distanceTier(km)];
}

export function buildWeeksFor(km: number): number {
  return { marathon: 6, half: 6, short: 4 }[distanceTier(km)];
}

export function recoveryWeeksFor(km: number): number {
  return distanceTier(km) === "marathon" ? 2 : 1;
}

/**
 * Weekly running-volume ceiling by the next A race's distance (§3). The
 * marathon figure is 70 rather than the elite-derived 85: this runner's normal
 * range is 40–60 km, and the 2026-27 build starts from an injury return.
 */
export function volumeCeilingFor(km: number): number {
  if (km >= 30) return 70;
  if (km >= 15) return 65;
  if (km >= 8) return 55;
  return 50;
}

export const PHASE_FOCUS: Record<SeasonPhase, string> = {
  base: "easy volume + one threshold session",
  build: "threshold + hard session, long run growing",
  peak: "race-specific intensity, long run holds",
  taper: "sharp and short, volume falling",
  race_week: "freshen up",
  recovery: "easy only",
  general: "3:1 fitness blocks",
};

const PRIORITY_RANK: Record<RacePriority, number> = { A: 0, B: 1, C: 2 };
/** Phases whose position is dictated by a race, not by the 3:1 counter. */
const STRUCTURAL_PHASES: ReadonlySet<SeasonPhase> = new Set(["taper", "race_week", "recovery"]);
const DEFAULT_WEEKS = 35;
/** Re-entry volume when there is no running history at all. */
const REENTRY_DEFAULT_KM = 20;

function taperFractions(n: number): number[] {
  if (n >= 3) return [0.75, 0.6, 0.45];
  if (n === 2) return [0.7, 0.5];
  return [0.6];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function band(target: number): { low: number; high: number } {
  return { low: round1(target * 0.9), high: round1(target * 1.1) };
}

// ---------------------------------------------------------------------------
// Raw computation (no stability) — §3.
// ---------------------------------------------------------------------------

type Slot = {
  phase: SeasonPhase | null;
  pos: BlockPosition | null;
  /** True when the position was set structurally (taper/race/recovery/B down). */
  fixed: boolean;
  raceInWeek: SeasonRace | null;
};

function computeRaw(input: SeasonInput): SeasonWeek[] {
  const N = input.weeks ?? DEFAULT_WEEKS;
  const w0 = mondayOf(input.today);
  const weekStarts = Array.from({ length: N }, (_, i) => addDays(w0, i * 7));
  const weekIndexOf = (date: string) => Math.floor(daysBetween(w0, date) / 7);

  const slots: Slot[] = weekStarts.map(() => ({ phase: null, pos: null, fixed: false, raceInWeek: null }));

  const inWindow = input.races
    .filter((r) => {
      const i = weekIndexOf(r.race_date);
      return i >= 0 && i < N;
    })
    .sort((a, b) => a.race_date.localeCompare(b.race_date));

  // Race inside week — highest priority (A > B > C), then earliest.
  for (const r of [...inWindow].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.race_date.localeCompare(b.race_date)
  )) {
    const i = weekIndexOf(r.race_date);
    if (!slots[i].raceInWeek) slots[i].raceInWeek = r;
  }

  // --- A races: right-to-left stacks, earliest race first, each stack running
  // back to the previous segment boundary (end of the prior race's recovery).
  let boundary = 0;
  for (const race of inWindow.filter((r) => r.priority === "A")) {
    const rw = weekIndexOf(race.race_date);
    if (rw < boundary) {
      // Overlaps the previous race's recovery (two A races days apart): the
      // race itself still wins its week.
      slots[rw] = { ...slots[rw], phase: "race_week", pos: "race", fixed: true };
    } else {
      // Compression rule: race_week, taper and peak are protected; build then
      // base absorb any shortfall (base first, since it fills last).
      let space = rw - boundary;
      const taper = Math.min(taperWeeksFor(race.distance_km), space);
      space -= taper;
      const peak = Math.min(peakWeeksFor(race.distance_km), space);
      space -= peak;
      const build = Math.min(buildWeeksFor(race.distance_km), space);
      space -= build;
      const base = space;

      let i = boundary;
      for (let k = 0; k < base; k++, i++) slots[i] = { ...slots[i], phase: "base" };
      for (let k = 0; k < build; k++, i++) slots[i] = { ...slots[i], phase: "build" };
      for (let k = 0; k < peak; k++, i++) slots[i] = { ...slots[i], phase: "peak" };
      for (let k = 0; k < taper; k++, i++) slots[i] = { ...slots[i], phase: "taper", pos: "taper", fixed: true };
      slots[rw] = { ...slots[rw], phase: "race_week", pos: "race", fixed: true };
    }
    const rec = recoveryWeeksFor(race.distance_km);
    for (let k = 1; k <= rec && rw + k < N; k++) {
      slots[rw + k] = { ...slots[rw + k], phase: "recovery", pos: "recovery", fixed: true };
    }
    boundary = rw + 1 + rec;
  }

  // Anything unassigned is general fitness.
  for (const s of slots) if (!s.phase) s.phase = "general";

  // --- B races: race week keeps its phase, position "race" (mini-taper by the
  // weekly generator), the following week is a forced down week. Inside an A
  // race's taper/race/recovery the A structure stands. C races: no effect.
  const progressive = (p: SeasonPhase | null) => p === "base" || p === "build" || p === "peak" || p === "general";
  for (const race of inWindow.filter((r) => r.priority === "B")) {
    const i = weekIndexOf(race.race_date);
    if (!progressive(slots[i].phase) || slots[i].fixed) continue;
    slots[i] = { ...slots[i], pos: "race", fixed: true };
    if (i + 1 < N && progressive(slots[i + 1].phase) && !slots[i + 1].fixed) {
      slots[i + 1] = { ...slots[i + 1], pos: "down", fixed: true };
    }
  }

  // --- 3:1 block filling, left to right; any fixed week ends the block.
  // Counting starts at the planning week (blockStartWeek); near weeks that
  // already have a stored position keep it, so a refresh continues the
  // sequence the runner has been living rather than restarting at "1".
  const storedPos = new Map((input.stored ?? []).map((s) => [s.week_start_date, s]));
  const blockStartIndex = input.blockStartWeek ? Math.max(0, weekIndexOf(input.blockStartWeek)) : 0;
  const PROGRESSIVE_POS: ReadonlySet<string> = new Set(["1", "2", "3", "down"]);
  let counter = 0;
  for (let i = 0; i < N; i++) {
    const s = slots[i];
    if (s.fixed) {
      counter = 0;
      continue;
    }
    if (i === blockStartIndex) counter = 0;
    const kept = i <= 7 ? storedPos.get(weekStarts[i]) : undefined;
    if (
      kept &&
      PROGRESSIVE_POS.has(kept.block_position) &&
      !STRUCTURAL_PHASES.has(kept.phase) &&
      kept.race_in_week_id === (s.raceInWeek?.id ?? null)
    ) {
      s.pos = kept.block_position;
      counter = kept.block_position === "down" ? 0 : Number(kept.block_position);
      continue;
    }
    counter += 1;
    if (counter <= 3) s.pos = String(counter) as BlockPosition;
    else {
      s.pos = "down";
      counter = 0;
    }
  }
  // No down week directly before a taper (or a race week when the taper was
  // compressed away): the last block becomes 2:1 — [1,2,3,down] → [1,2,down,1].
  for (let i = 0; i < N - 1; i++) {
    const s = slots[i];
    const next = slots[i + 1];
    if (s.pos === "down" && !s.fixed && (next.phase === "taper" || next.phase === "race_week")) {
      if (i > 0 && slots[i - 1].pos === "3" && !slots[i - 1].fixed) slots[i - 1].pos = "down";
      s.pos = "1";
    }
  }

  // --- Volume bands (§3).
  const fitness =
    input.currentFitnessKm > 0
      ? input.currentFitnessKm
      : input.last7Km > 0
        ? input.last7Km
        : REENTRY_DEFAULT_KM;
  const aRaces = inWindow.filter((r) => r.priority === "A");
  const nextA = (i: number) => aRaces.find((r) => weekIndexOf(r.race_date) >= i) ?? null;
  const nextAB = (i: number) =>
    inWindow.find((r) => r.priority !== "C" && weekIndexOf(r.race_date) >= i) ?? null;

  // 10% rule at the seam with real life: the first progressive target may not
  // exceed what the last 7 days support (+10%), even when the 4-week average
  // is higher — otherwise a hold week (say 20 km after a niggle) is followed
  // by a leap straight back to the average. The plan then ramps from where the
  // runner actually is.
  const derivedSeed =
    input.runningCeilingKm && input.runningCeilingKm > 0
      ? Math.min(fitness, input.runningCeilingKm)
      : fitness;
  // A runner-set band on the planning week recalibrates everything: the curve
  // seeds from its midpoint and the near-week 10% clamp stands aside (the
  // runner has declared what they can do this week).
  // Look in the pinned weeks (next week first, then this week): before the
  // Sunday 17:00 flip the planning week is still the current one, and a
  // runner-set band on either is the anchor.
  const overrideIndex = [1, 0].find((i) => i < N && storedPos.get(weekStarts[i])?.volume_override);
  const overrideRow = overrideIndex === undefined ? undefined : storedPos.get(weekStarts[overrideIndex]);
  const seedOverridden = Boolean(overrideRow?.volume_override);
  const seed = seedOverridden
    ? (overrideRow!.volume_low_km + overrideRow!.volume_high_km) / 2
    : derivedSeed;

  // Volume is planned right-to-left too. A "segment" runs from week 0 (or the
  // week after a recovery block) up to the taper of its A race. Within it the
  // progressive weeks are indexed k = 0..P-1 and two curves are drawn:
  //   forward  = seed × 1.09^k          (the fastest the 10% rule allows)
  //   backward = peak ÷ 1.09^(P-1-k)    (what reaches the peak exactly at the
  //                                       last progressive week before taper)
  // The target is min(forward, max(backward, seed)): never faster than the
  // rule, never higher than needed to peak on time, never below where the
  // runner already is. If the forward curve cannot reach the peak in time,
  // it simply rules — the peak is whatever the runner can safely get to.
  const PROGRESS = 1.09;
  const isProgressivePos = (p: BlockPosition | null) => p === "1" || p === "2" || p === "3";
  type Segment = { start: number; end: number; progressive: number[]; ceiling: number; hasA: boolean };
  const segments: Segment[] = [];
  {
    let start = 0;
    for (let i = 0; i <= N; i++) {
      const endsHere = i === N || (i > 0 && slots[i - 1].pos === "recovery" && slots[i].pos !== "recovery");
      if (!endsHere) continue;
      const a = nextA(start);
      const progressive: number[] = [];
      for (let j = start; j < i; j++) if (isProgressivePos(slots[j].pos)) progressive.push(j);
      segments.push({
        start,
        end: i,
        progressive,
        ceiling: a ? volumeCeilingFor(a.distance_km) : fitness * 1.2,
        hasA: Boolean(a),
      });
      start = i;
    }
  }
  const segmentOf = (i: number) => segments.find((g) => i >= g.start && i < g.end)!;

  const rows: SeasonWeek[] = [];
  let segSeed = seed; // where this segment's forward curve starts
  let lastProgressive = seed; // latest progressive target (B race weeks key off it)
  let prevTarget = seed;
  let segmentPeak = seed; // highest progressive target in the segment so far

  for (let i = 0; i < N; i++) {
    const s = slots[i];
    const phase = s.phase as SeasonPhase;
    const pos = s.pos as BlockPosition;
    const seg = segmentOf(i);

    let target: number;
    switch (pos) {
      case "1":
      case "2":
      case "3": {
        const k = seg.progressive.indexOf(i);
        const P = seg.progressive.length;
        // The forward curve steps 9% per progressive week FROM the seed week:
        // week 0 normally, or the runner-set week when one anchors the plan.
        const kSeed =
          seedOverridden && overrideIndex !== undefined && seg.start === 0
            ? Math.max(0, seg.progressive.indexOf(overrideIndex))
            : 0;
        const forward = Math.min(segSeed * Math.pow(PROGRESS, Math.max(0, k - kSeed)), seg.ceiling);
        if (seg.hasA) {
          const backward = seg.ceiling / Math.pow(PROGRESS, Math.max(0, P - 1 - k));
          target = Math.min(forward, Math.max(backward, segSeed));
        } else {
          target = forward;
        }
        lastProgressive = target;
        segmentPeak = Math.max(segmentPeak, target);
        break;
      }
      case "down":
        // Consolidation: a quarter off the previous week.
        target = prevTarget * 0.75;
        break;
      case "taper": {
        let k = 0;
        while (i - k - 1 >= 0 && slots[i - k - 1].phase === "taper") k++;
        let n = k + 1;
        while (i + (n - k) < N && slots[i + (n - k)].phase === "taper") n++;
        target = segmentPeak * taperFractions(n)[Math.min(k, 2)];
        break;
      }
      case "race":
        // A race week: ~40% of peak. B race inside a progressive phase: a
        // lighter progressive week (the generator handles the mini-taper).
        target = phase === "race_week" ? segmentPeak * 0.4 : lastProgressive * 0.85;
        break;
      case "recovery":
      default: {
        target = segmentPeak * 0.5;
        // Re-enter the next segment at ~70% of the peak just raced from.
        segSeed = segmentPeak * 0.7;
        lastProgressive = segSeed;
        break;
      }
    }
    // Never above the weekly context's 10%-rule ceiling for the near weeks —
    // unless the runner has set the planning week's volume by hand.
    if (!seedOverridden && input.runningCeilingKm && i <= 1 && target > input.runningCeilingKm) {
      target = input.runningCeilingKm;
    }
    prevTarget = target;
    // After the recovery block the peak reference resets to the re-entry level.
    if (pos === "recovery" && (i + 1 >= N || slots[i + 1].pos !== "recovery")) {
      segmentPeak = segSeed;
    }

    const { low, high } = band(target);
    const pointing = nextAB(i);
    let focus = PHASE_FOCUS[phase];
    if (pos === "down") focus = "down week — consolidate: 70–80% volume, one quality session, shorter long run";
    if (pos === "race" && phase !== "race_week") focus = `${focus}; B race this week — 3–4 day mini-taper`;

    rows.push({
      week_start_date: weekStarts[i],
      phase,
      block_position: pos,
      volume_low_km: low,
      volume_high_km: high,
      focus,
      stability: "fuzzy",
      race_id: pointing?.id ?? null,
      race_in_week_id: s.raceInWeek?.id ?? null,
      volume_override: false,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Stability merge (§4) — fuzzy far, stable near.
// ---------------------------------------------------------------------------

const STRUCTURAL: ReadonlySet<SeasonPhase> = STRUCTURAL_PHASES;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * The season plan for the horizon, merged against stored rows:
 * - weeks 0–1 pinned (stored reused; a race change inside the week adopts the
 *   new structure; a load flag / "too hard" check-in lowers the band to
 *   last-7 ± 10% with the block position kept),
 * - weeks 2–7 firm (stored phase/position kept unless a race now dictates
 *   taper/race/recovery structure; band moves at most ±10% toward the new),
 * - week 8+ fuzzy (replaced).
 * Past weeks are the caller's business — this never emits them.
 */
export function computeSeason(input: SeasonInput): SeasonWeek[] {
  const raw = computeRaw(input);
  const stored = new Map((input.stored ?? []).map((s) => [s.week_start_date, s]));
  const holdWeek = input.holdWeek ?? mondayOf(input.today);
  const holdSignal = Boolean(input.loadFlag || input.tooHardCheckin);
  const holdBand =
    input.last7Km > 0 ? { low: round1(input.last7Km * 0.9), high: round1(input.last7Km * 1.1) } : null;
  // A runner-set band on the planning week is a deliberate recalibration: the
  // firm weeks adopt the re-seeded curve outright (structure kept) instead of
  // creeping towards it 10% per refresh.
  const reseeded = raw.slice(0, 2).some((n) => stored.get(n.week_start_date)?.volume_override);

  return raw.map((n, i) => {
    const s = stored.get(n.week_start_date);

    if (i <= 1) {
      const row: SeasonWeek = s ? { ...s } : { ...n };
      const raceChanged = s ? s.race_in_week_id !== n.race_in_week_id : false;
      if (raceChanged) {
        row.phase = n.phase;
        row.block_position = n.block_position;
        row.focus = n.focus;
      }
      row.race_id = n.race_id;
      row.race_in_week_id = n.race_in_week_id;
      const hold = raceChanged || (holdSignal && n.week_start_date === holdWeek);
      if (hold && holdBand && !STRUCTURAL.has(row.phase) && !row.volume_override) {
        row.volume_low_km = holdBand.low;
        row.volume_high_km = holdBand.high;
        if (!row.focus.startsWith("hold")) row.focus = `hold — consolidate at last week's volume; ${row.focus}`;
      }
      row.stability = "pinned";
      return row;
    }

    if (i <= 7) {
      if (!s) return { ...n, stability: "firm" };
      const structural =
        STRUCTURAL.has(n.phase) || n.block_position === "race" || s.race_in_week_id !== n.race_in_week_id;
      return {
        week_start_date: n.week_start_date,
        phase: structural ? n.phase : s.phase,
        block_position: structural ? n.block_position : s.block_position,
        focus: structural ? n.focus : s.focus,
        volume_low_km: s.volume_override
          ? s.volume_low_km
          : reseeded
            ? n.volume_low_km
            : round1(clamp(n.volume_low_km, s.volume_low_km * 0.9, s.volume_low_km * 1.1)),
        volume_high_km: s.volume_override
          ? s.volume_high_km
          : reseeded
            ? n.volume_high_km
            : round1(clamp(n.volume_high_km, s.volume_high_km * 0.9, s.volume_high_km * 1.1)),
        volume_override: s.volume_override ?? false,
        stability: "firm",
        race_id: n.race_id,
        race_in_week_id: n.race_in_week_id,
      };
    }

    return { ...n, stability: "fuzzy" };
  });
}

// ---------------------------------------------------------------------------
// Presentation helpers shared by the prompt, the voice briefing and the UI.
// ---------------------------------------------------------------------------

/**
 * A spoken/typed race time → Postgres interval text ("HH:MM:SS"), or null.
 * Accepts "1:25:30", "1:25" (h:mm), "25:30" (mm:ss when the first part is
 * ≥ 3 — nobody targets a 25-hour race), "1h 25m", "1 hour 25", "85 minutes".
 */
export function parseIntervalText(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (h: number, m: number, sec: number) => `${pad(h)}:${pad(m)}:${pad(sec)}`;
  const clock = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (clock) {
    const a = Number(clock[1]);
    const b = Number(clock[2]);
    if (clock[3] !== undefined) return fmt(a, b, Number(clock[3]));
    return a >= 3 ? fmt(0, a, b) : fmt(a, b, 0);
  }
  const hm = s.match(/^(\d+)\s*(?:h|hr|hrs|hour|hours)\s*(\d+)?\s*(?:m|min|mins|minutes)?\s*(\d+)?\s*(?:s|sec|secs|seconds)?$/);
  if (hm) return fmt(Number(hm[1]), Number(hm[2] ?? 0), Number(hm[3] ?? 0));
  const mins = s.match(/^([\d.]+)\s*(?:m|min|mins|minutes)(?:\s*(\d+)\s*(?:s|sec|secs|seconds))?$/);
  if (mins) {
    const total = Math.round(Number(mins[1]) * 60) + Number(mins[2] ?? 0);
    return fmt(Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60);
  }
  return null;
}

/** Pairs of A races within 6 weeks of each other (Season screen banner). */
export function findCloseARaces(races: SeasonRace[]): Array<[SeasonRace, SeasonRace]> {
  const a = races.filter((r) => r.priority === "A").sort((x, y) => x.race_date.localeCompare(y.race_date));
  const out: Array<[SeasonRace, SeasonRace]> = [];
  for (let i = 1; i < a.length; i++) {
    if (daysBetween(a[i - 1].race_date, a[i].race_date) <= 42) out.push([a[i - 1], a[i]]);
  }
  return out;
}

export const PHASE_LABELS: Record<SeasonPhase, string> = {
  base: "Base",
  build: "Build",
  peak: "Peak",
  taper: "Taper",
  race_week: "Race week",
  recovery: "Recovery",
  general: "General fitness",
};

/** "week 2 of 3", "down week", "taper", "race week", "recovery week". */
export function blockLabel(row: SeasonWeek): string {
  switch (row.block_position) {
    case "1":
    case "2":
    case "3":
      return `week ${row.block_position} of 3`;
    case "down":
      return "down week";
    case "taper":
      return "taper";
    case "race":
      return row.phase === "race_week" ? "race week" : "race this week";
    default:
      return "recovery week";
  }
}

/** Whole weeks from a week's Monday to a race date (0 = inside that week). */
export function weeksUntil(weekStart: string, raceDate: string): number {
  return Math.floor(daysBetween(weekStart, raceDate) / 7);
}

/**
 * One-line season position, e.g.
 * "Peak, week 2 of 3 — Manchester Half (A) in 3 weeks; parkrun (C) this week".
 */
export function seasonLine(
  row: SeasonWeek | null,
  races: SeasonRace[],
  weekStart: string
): string {
  if (!row) return "no season plan yet — training for general fitness";
  const parts: string[] = [`${PHASE_LABELS[row.phase]}, ${blockLabel(row)}`];
  const pointing = races.find((r) => r.id === row.race_id);
  const inWeek = races.find((r) => r.id === row.race_in_week_id);
  const tail: string[] = [];
  if (pointing) {
    const w = weeksUntil(weekStart, pointing.race_date);
    tail.push(`${pointing.name} (${pointing.priority}) ${w <= 0 ? "this week" : `in ${w} week${w === 1 ? "" : "s"}`}`);
  }
  if (inWeek && inWeek.id !== pointing?.id) tail.push(`${inWeek.name} (${inWeek.priority}) this week`);
  if (tail.length === 0 && row.phase === "general") tail.push("no race scheduled");
  return tail.length > 0 ? `${parts[0]} — ${tail.join("; ")}` : parts[0];
}
