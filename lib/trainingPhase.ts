export type TrainingPhase = "base" | "build" | "peak" | "taper" | "race_week" | "post_race";

function taperWeeksFor(distanceKm: number) {
  if (distanceKm >= 30) return 3; // marathon+
  if (distanceKm >= 15) return 2; // half marathon
  return 1; // 10k and shorter
}

function peakWeeksFor(distanceKm: number) {
  if (distanceKm >= 30) return 6;
  if (distanceKm >= 15) return 4;
  return 2;
}

function buildWeeksFor(distanceKm: number) {
  if (distanceKm >= 30) return 12;
  if (distanceKm >= 15) return 10;
  return 6;
}

export function getTrainingPhase(raceDate: Date, distanceKm: number, now: Date = new Date()): {
  phase: TrainingPhase;
  weeksToRace: number;
} {
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeksToRace = (raceDate.getTime() - now.getTime()) / msPerWeek;

  if (weeksToRace < -1) return { phase: "post_race", weeksToRace };
  if (weeksToRace <= 0.5) return { phase: "race_week", weeksToRace };

  const taper = taperWeeksFor(distanceKm);
  const peak = peakWeeksFor(distanceKm);
  const build = buildWeeksFor(distanceKm);

  if (weeksToRace <= taper) return { phase: "taper", weeksToRace };
  if (weeksToRace <= peak) return { phase: "peak", weeksToRace };
  if (weeksToRace <= build) return { phase: "build", weeksToRace };
  return { phase: "base", weeksToRace };
}
