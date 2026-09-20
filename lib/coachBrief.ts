import { readFileSync } from "node:fs";
import path from "node:path";

// The coach's standing philosophy (docs/COACH.md), sent verbatim on every plan
// generation and revision. Read from disk so the runner can edit coaching
// rules without touching code; cached per warm lambda (edits ship with a
// deploy anyway). next.config.mjs traces the file into the API bundles; if it
// is ever missing, the in-code principles keep generation working.
const COACH_PATH = path.join(process.cwd(), "docs", "COACH.md");

let cached: string | null = null;

export function coachBrief(fallback: string): string {
  if (cached !== null) return cached;
  try {
    const text = readFileSync(COACH_PATH, "utf8").trim();
    cached = `COACHING BRIEF (the coach's standing philosophy — follow it; the live data above says what is true this week, this says how to coach it):\n${text}`;
  } catch (err) {
    console.warn(
      "docs/COACH.md not readable — falling back to in-code principles:",
      err instanceof Error ? err.message : err
    );
    cached = fallback;
  }
  return cached;
}
