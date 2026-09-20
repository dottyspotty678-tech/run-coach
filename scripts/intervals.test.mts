// Unit tests for the pure half of lib/intervals.ts (docs/WATCH-SYNC.md §3).
// Run with:  node --test scripts/intervals.test.mts   (or npm test)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eventsForWeek,
  startTimeFor,
  stepsToWorkoutText,
  workoutTextFor,
  type IcuEvent,
} from "../lib/intervals.ts";
import type { TrainingDay, WorkoutStep } from "../lib/planTypes.ts";

const WEEK = "2026-09-21"; // Monday

function day(overrides: Partial<TrainingDay> & Pick<TrainingDay, "date" | "session_type">): TrainingDay {
  return {
    title: "Session",
    detail: "Detail text.",
    duration_min: 45,
    why: "Because.",
    is_travel_day: false,
    ...overrides,
  };
}

test("steps → workout text: repeat block with blank lines, pace ranges, minutes vs km, metres", () => {
  const steps: WorkoutStep[] = [
    { kind: "step", label: "Warm-up", minutes: 10, pace_low: "5:00", pace_high: "5:30" },
    {
      kind: "repeat",
      times: 5,
      steps: [
        { kind: "step", label: "Threshold", km: 1, pace_low: "3:55", pace_high: "4:05" },
        { kind: "step", label: "Recovery", minutes: 1.5, pace_low: "5:30", pace_high: "5:30" },
      ],
    },
    { kind: "step", label: "Strides", km: 0.4, pace_low: "3:15", pace_high: "3:20" },
    { kind: "step", label: "Cool-down", minutes: 8 },
  ];
  const text = stepsToWorkoutText(steps);
  assert.equal(
    text,
    [
      "- Warm-up 10m 5:00-5:30/km Pace",
      "",
      "- 5x",
      "  - Threshold 1km 3:55-4:05/km Pace",
      "  - Recovery 90s 5:30/km Pace",
      "",
      "- Strides 400mtr 3:15-3:20/km Pace",
      "- Cool-down 8m",
    ].join("\n")
  );
});

test("start times: weekdays 18:30, weekends 09:00", () => {
  assert.equal(startTimeFor("2026-09-21"), "2026-09-21T18:30:00"); // Monday
  assert.equal(startTimeFor("2026-09-25"), "2026-09-25T18:30:00"); // Friday
  assert.equal(startTimeFor("2026-09-26"), "2026-09-26T09:00:00"); // Saturday
  assert.equal(startTimeFor("2026-09-27"), "2026-09-27T09:00:00"); // Sunday
});

test("eventsForWeek: type mapping, external ids, moving time, no rest/cross events", () => {
  const days: TrainingDay[] = [
    day({ date: "2026-09-21", session_type: "rest", duration_min: 0, title: "Rest" }),
    day({
      date: "2026-09-22",
      session_type: "strength",
      title: "Gym strength",
      duration_min: 50,
      detail: "Squats, hinge, push, pull.",
    }),
    day({
      date: "2026-09-23",
      session_type: "tempo",
      title: "Threshold",
      duration_min: 50,
      steps: [
        { kind: "step", label: "Warm-up", minutes: 10, pace_low: "5:00", pace_high: "5:30" },
        { kind: "step", label: "Tempo", minutes: 30, pace_low: "3:55", pace_high: "4:05" },
        { kind: "step", label: "Cool-down", minutes: 10, pace_low: "5:00", pace_high: "5:30" },
      ],
    }),
    day({ date: "2026-09-24", session_type: "cross", title: "Climbing", duration_min: 90 }),
    day({ date: "2026-09-25", session_type: "easy", title: "Easy run", duration_min: 40 }),
    day({ date: "2026-09-26", session_type: "long", title: "Long run", duration_min: 85 }),
    day({ date: "2026-09-27", session_type: "race", title: "parkrun", duration_min: 25 }),
    // Outside the week — ignored.
    day({ date: "2026-09-28", session_type: "easy", title: "Next week" }),
  ];
  const events = eventsForWeek(days, WEEK);
  const byDate = new Map(events.map((e) => [e.external_id, e] as [string, IcuEvent]));

  assert.deepEqual(
    events.map((e) => e.external_id),
    ["runcoach:2026-09-22", "runcoach:2026-09-23", "runcoach:2026-09-25", "runcoach:2026-09-26", "runcoach:2026-09-27"]
  );
  assert.equal(byDate.has("runcoach:2026-09-21"), false, "rest day produces no event");
  assert.equal(byDate.has("runcoach:2026-09-24"), false, "cross day produces no event");
  assert.equal(byDate.has("runcoach:2026-09-28"), false, "next week's day is ignored");

  const gym = byDate.get("runcoach:2026-09-22")!;
  assert.equal(gym.type, "WeightTraining");
  assert.equal(gym.target, undefined);
  assert.equal(gym.moving_time, 3000);
  assert.ok(gym.description.startsWith("Squats, hinge, push, pull."));
  assert.equal(gym.start_date_local, "2026-09-22T18:30:00");

  const tempo = byDate.get("runcoach:2026-09-23")!;
  assert.equal(tempo.type, "Run");
  assert.equal(tempo.target, "PACE");
  assert.equal(tempo.category, "WORKOUT");
  assert.equal(tempo.name, "Threshold");
  assert.equal(tempo.description.split("\n")[1], "- Tempo 30m 3:55-4:05/km Pace");

  for (const id of ["runcoach:2026-09-25", "runcoach:2026-09-26", "runcoach:2026-09-27"]) {
    assert.equal(byDate.get(id)!.type, "Run", `${id} maps to Run`);
  }
  assert.equal(byDate.get("runcoach:2026-09-26")!.start_date_local, "2026-09-26T09:00:00");
});

test("prose fallback when a run has no steps (older plans)", () => {
  const d = day({
    date: "2026-09-25",
    session_type: "easy",
    detail: "40 min easy, conversational.",
    why: "Recovery between quality days.",
  });
  assert.equal(workoutTextFor(d), "40 min easy, conversational.\n\nRecovery between quality days.");
  const [event] = eventsForWeek([d], WEEK);
  assert.equal(event.type, "Run");
  assert.equal(event.description, "40 min easy, conversational.\n\nRecovery between quality days.");
  // Empty steps array also falls back.
  assert.equal(workoutTextFor({ ...d, steps: [] }), workoutTextFor(d));
});
