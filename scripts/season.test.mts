// Unit tests for the pure season planner (docs/SEASON-PLAN.md §3–§4).
// Run with:  node --test scripts/season.test.mts
// (Node strips the types itself; lib/season.ts has no imports on purpose.)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  computeSeason,
  findCloseARaces,
  mondayOf,
  type SeasonRace,
  type SeasonWeek,
} from "../lib/season.ts";

const TODAY = "2026-09-16"; // a Wednesday
const W0 = mondayOf(TODAY); // 2026-09-14
const week = (i: number) => addDays(W0, i * 7);

function race(
  id: number,
  weeksOut: number,
  distance_km: number,
  priority: SeasonRace["priority"] = "A",
  dayOffset = 6 // Sunday of that week
): SeasonRace {
  return { id, name: `Race ${id}`, distance_km, race_date: addDays(week(weeksOut), dayOffset), priority };
}

function phases(rows: SeasonWeek[]): string[] {
  return rows.map((r) => r.phase);
}
function positions(rows: SeasonWeek[]): string[] {
  return rows.map((r) => r.block_position);
}
function count(rows: SeasonWeek[], from: number, to: number, phase: string): number {
  return rows.slice(from, to).filter((r) => r.phase === phase).length;
}

test("single marathon 20 weeks out: full right-to-left stack", () => {
  const rows = computeSeason({
    races: [race(1, 20, 42.2)],
    today: TODAY,
    currentFitnessKm: 45,
    last7Km: 46,
    weeks: 35,
  });
  assert.equal(rows.length, 35);
  assert.equal(rows[0].week_start_date, W0);
  // Race week, then taper 3, peak 3, build 6, base fills the rest back to week 0.
  assert.equal(rows[20].phase, "race_week");
  assert.equal(rows[20].block_position, "race");
  assert.deepEqual(phases(rows).slice(17, 20), ["taper", "taper", "taper"]);
  assert.deepEqual(phases(rows).slice(14, 17), ["peak", "peak", "peak"]);
  assert.equal(count(rows, 8, 14, "build"), 6);
  assert.equal(count(rows, 0, 8, "base"), 8);
  // Recovery 2 weeks for a marathon, then general fitness.
  assert.deepEqual(phases(rows).slice(21, 23), ["recovery", "recovery"]);
  assert.equal(rows[23].phase, "general");
  // 3:1 blocks run left to right from week 0; never a down week right before the taper.
  assert.deepEqual(positions(rows).slice(0, 4), ["1", "2", "3", "down"]);
  assert.notEqual(rows[16].block_position, "down");
  // Volumes: first week starts at fitness, progressive weeks climb ≤ ~9%, ceiling 70 km,
  // and the last progressive week before the taper reaches the ceiling (right-to-left).
  assert.ok(rows[0].volume_low_km <= 45 && rows[0].volume_high_km >= 45);
  for (let i = 1; i < 17; i++) {
    assert.ok(rows[i].volume_high_km <= 70 * 1.1 + 0.05, `week ${i} above marathon ceiling`);
  }
  assert.ok(rows[16].volume_high_km >= 70 * 1.1 - 0.05, "peak week reaches the ceiling");
  for (let i = 1; i < 17; i++) {
    if (["1", "2", "3"].includes(rows[i].block_position) && ["1", "2", "3"].includes(rows[i - 1].block_position)) {
      assert.ok(rows[i].volume_high_km <= rows[i - 1].volume_high_km * 1.1 + 0.05, `week ${i} climbs > 10%`);
    }
  }
  // Taper falls, race week ~40% of peak, recovery ~50%.
  assert.ok(rows[17].volume_high_km > rows[18].volume_high_km);
  assert.ok(rows[18].volume_high_km > rows[19].volume_high_km);
  assert.ok(rows[20].volume_high_km < rows[19].volume_high_km);
  assert.ok(rows[21].volume_high_km > rows[20].volume_high_km);
  // Every week up to the race points at it; the race week carries it.
  assert.equal(rows[0].race_id, 1);
  assert.equal(rows[20].race_in_week_id, 1);
  assert.equal(rows[21].race_id, null);
  // Fresh computation is fuzzy beyond week 8, pinned/firm before.
  assert.equal(rows[0].stability, "pinned");
  assert.equal(rows[1].stability, "pinned");
  assert.equal(rows[2].stability, "firm");
  assert.equal(rows[7].stability, "firm");
  assert.equal(rows[8].stability, "fuzzy");
});

test("half marathon 6 weeks out: compression keeps race, taper and peak", () => {
  const rows = computeSeason({
    races: [race(2, 6, 21.1)],
    today: TODAY,
    currentFitnessKm: 50,
    last7Km: 50,
    weeks: 12,
  });
  assert.equal(rows[6].phase, "race_week");
  assert.deepEqual(phases(rows).slice(4, 6), ["taper", "taper"]);
  assert.deepEqual(phases(rows).slice(2, 4), ["peak", "peak"]);
  // Only 2 weeks left for build (of 6) and none for base.
  assert.deepEqual(phases(rows).slice(0, 2), ["build", "build"]);
  assert.equal(count(rows, 0, 6, "base"), 0);
  assert.equal(rows[7].phase, "recovery");
  assert.equal(rows[8].phase, "general");
  // Half ceiling 65 km.
  for (let i = 0; i < 4; i++) assert.ok(rows[i].volume_high_km <= 65 * 1.1 + 0.05);
});

test("A + B + C mix: B gets race + down, C leaves structure alone", () => {
  const races = [race(1, 16, 21.1, "A"), race(2, 6, 10, "B"), race(3, 3, 5, "C")];
  const rows = computeSeason({ races, today: TODAY, currentFitnessKm: 40, last7Km: 40, weeks: 24 });
  // B race week: phase kept (build/base), position "race", following week a down week.
  assert.equal(rows[6].block_position, "race");
  assert.notEqual(rows[6].phase, "race_week");
  assert.equal(rows[6].race_in_week_id, 2);
  assert.equal(rows[7].block_position, "down");
  // Block restarts after the forced down.
  assert.equal(rows[8].block_position, "1");
  // C race: marked in the week, no structural change.
  assert.equal(rows[3].race_in_week_id, 3);
  assert.ok(["1", "2", "3", "down"].includes(rows[3].block_position));
  assert.ok(rows[3].phase === "base" || rows[3].phase === "build");
  // Weeks before the B race point at it (next A/B); after it, at the A race.
  assert.equal(rows[0].race_id, 2);
  assert.equal(rows[8].race_id, 1);
  // The A race still anchors: race week + 2-week taper + 1 recovery week.
  assert.equal(rows[16].phase, "race_week");
  assert.deepEqual(phases(rows).slice(14, 16), ["taper", "taper"]);
  assert.equal(rows[17].phase, "recovery");
});

test("no races: general phase, 3:1 blocks, ceiling = fitness + 20%", () => {
  const rows = computeSeason({ races: [], today: TODAY, currentFitnessKm: 40, last7Km: 38, weeks: 10 });
  assert.ok(rows.every((r) => r.phase === "general"));
  assert.deepEqual(positions(rows).slice(0, 8), ["1", "2", "3", "down", "1", "2", "3", "down"]);
  for (const r of rows) {
    assert.ok(r.volume_high_km <= 48 * 1.1 + 0.05, `week ${r.week_start_date} above general ceiling`);
    assert.equal(r.race_id, null);
  }
  assert.ok(rows[3].volume_high_km < rows[2].volume_high_km, "down week is lighter");
});

test("stability merge: pinned reused, firm clamped ±10%, fuzzy replaced, hold on load flag", () => {
  const input = { races: [race(1, 20, 42.2)], today: TODAY, currentFitnessKm: 45, last7Km: 40, weeks: 35 };
  const first = computeSeason(input);
  // Fitness jumps: the fresh computation would move every band up.
  const stored = first.map((r) => ({ ...r }));
  const second = computeSeason({ ...input, currentFitnessKm: 60, last7Km: 60, stored });

  // Pinned: weeks 0–1 come back unchanged.
  assert.deepEqual(
    { ...second[0], stability: "x" },
    { ...stored[0], stability: "x" }
  );
  assert.equal(second[0].stability, "pinned");
  assert.equal(second[1].stability, "pinned");

  // Firm: phase/position kept, bands moved at most 10% toward the new value.
  for (let i = 2; i <= 7; i++) {
    assert.equal(second[i].phase, stored[i].phase);
    assert.equal(second[i].block_position, stored[i].block_position);
    assert.ok(second[i].volume_high_km <= stored[i].volume_high_km * 1.1 + 0.05, `week ${i} moved > 10%`);
    assert.ok(second[i].volume_low_km >= stored[i].volume_low_km * 0.9 - 0.05);
    assert.equal(second[i].stability, "firm");
  }
  assert.ok(second[3].volume_high_km > stored[3].volume_high_km, "firm week moved toward the new band");

  // Fuzzy: fully replaced by the new computation (week 8 is the first fuzzy
  // week; later build weeks hit the 85 km marathon ceiling in both runs).
  const fresh = computeSeason({ ...input, currentFitnessKm: 60, last7Km: 60 });
  assert.deepEqual(second[8], { ...fresh[8], stability: "fuzzy" });
  assert.ok(second[8].volume_high_km > stored[8].volume_high_km);
  assert.deepEqual(second[12], { ...fresh[12], stability: "fuzzy" });

  // Hold: a load flag lowers the pinned week's band to last-7 ± 10%, block position kept.
  const held = computeSeason({ ...input, stored, loadFlag: true, last7Km: 30, holdWeek: W0 });
  assert.equal(held[0].block_position, stored[0].block_position);
  assert.equal(held[0].volume_low_km, 27);
  assert.equal(held[0].volume_high_km, 33);
  assert.ok(held[0].focus.startsWith("hold"));
  // The other pinned week is untouched by the hold.
  assert.equal(held[1].volume_high_km, stored[1].volume_high_km);

  // A race added inside a pinned week adopts the new structure.
  const withRace = computeSeason({
    ...input,
    races: [race(1, 20, 42.2), race(9, 1, 10, "B")],
    stored,
  });
  assert.equal(withRace[1].race_in_week_id, 9);
  assert.equal(withRace[1].block_position, "race");
});

test("two A races within 6 weeks are flagged", () => {
  const pairs = findCloseARaces([race(1, 10, 21.1), race(2, 14, 10), race(3, 30, 42.2)]);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0][0].id, pairs[0][1].id], [1, 2]);
});
