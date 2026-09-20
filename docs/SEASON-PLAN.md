# Season plan — multi-race, right-to-left periodisation (v3)

Replaces the single `race_goal` and the fixed phase windows in
`lib/trainingPhase.ts` with a list of races and a deterministic season
planner that works BACKWARDS from every race in the next 8 months. The weekly
Claude generation consumes the planner's row for its week; it no longer
decides phase, block position or volume band itself. User decisions recorded
here (20 Sep 2026): A/B/C race priorities; peak volume derived from history;
2 weeks pinned / 6 firm / rest fuzzy; a read-only Season screen off the Plan
tab. COACH.md remains the coaching philosophy; this document is the
structural contract.

## 1. Data model

```sql
create table if not exists races (
  id bigint generated always as identity primary key,
  name text not null,
  distance_km real not null,
  race_date date not null,
  priority text not null default 'A' check (priority in ('A','B','C')),
  target_time interval,
  result_time interval,          -- filled after the race (check-in or Settings)
  result_notes text,
  created_at timestamptz not null default now()
);

create table if not exists season_plan (
  week_start_date date primary key,          -- Monday
  phase text not null,                        -- base|build|peak|taper|race_week|recovery|general
  block_position text not null,               -- '1'|'2'|'3'|'down'|'taper'|'race'|'recovery'
  volume_low_km real not null,
  volume_high_km real not null,
  focus text not null,                        -- one line, e.g. "threshold + long run to 26 km"
  stability text not null,                    -- pinned|firm|fuzzy
  race_id bigint references races(id),        -- the race this week points at (next A/B), null if none
  race_in_week_id bigint references races(id),-- a race that falls inside this week
  generated_at timestamptz not null default now()
);
```

Migration: copy the existing `race_goal` row (if any) into `races` as priority
A; the app stops reading `race_goal` (leave the table in place, unused).

## 2. Race priorities

- **A** — anchors the season: full taper, race week, then recovery week(s).
- **B** — raced hard inside the build: the race week is `race` with a 3–4 day
  mini-taper handled by the weekly generator (easy days Thu–Sat, race
  Sat/Sun); the following week is a `down` week; no structural taper before.
- **C** — a training race: no structural effect. The week keeps its phase; the
  generator swaps that day's quality session for the race and eases the day
  before.

Two A races within 6 weeks: the planner keeps both A (the user chose them)
but flags the pair on the Season screen ("too close for a full rebuild —
the second race is treated as a second peak").

## 3. Right-to-left algorithm (lib/season.ts, pure and unit-testable)

Inputs: races in the window [current week, +35 weeks]; current fitness =
4-week average weekly running km from the unified activity stream (falls
back to last-7 if the 4-week figure is 0); stored `season_plan` rows (for
stability); the current LOAD FLAG / latest check-in tone.

For each A race, from its race week backwards (windows reuse the distance
tiers already in trainingPhase.ts):
1. `race_week` (1 week).
2. `taper`: marathon+ 3 weeks, half 2, 10k-and-under 1.
3. `peak`: marathon 3, half 2, 10k 1.
4. `build`: marathon 6, half 6, 10k 4.
5. `base`: whatever remains back to the previous segment boundary.
6. After the race: `recovery` — 2 weeks for marathon+, 1 otherwise.

If the race is too close for the full stack, keep race_week, taper and peak
fixed and shorten build then base. Between segments (and when there are no
races: `general` phase), fill weeks with **3:1 blocks** left-to-right from
the segment start: positions 1, 2, 3, down. No `down` week directly before a
taper — if it would land there, the last block becomes 2:1. Recovery weeks
count as `down`.

**Volume bands** (target ± 10% → low/high): start at current fitness.
Progressive weeks: +8–10% on the previous progressive week. `down`: 70–80%
of the previous week. `taper`: 75% → 60% → 45% of peak across the taper
weeks. `race_week`: ~40% (race excluded). `recovery`: ~50%. Ceilings by the
next A race's distance: marathon 85 km, half 65, 10k 55, 5k 50; `general`
phase: current fitness + 20%. Never above the 10%-rule ceiling the weekly
context computes.

**Focus** line per phase: base "easy volume + one threshold session";
build "threshold + hard session, long run growing"; peak "race-specific
intensity, long run holds"; taper "sharp and short, volume falling";
race_week "freshen up"; recovery "easy only"; general "3:1 fitness blocks".

## 4. Stability (the fuzzy-far / stable-near rule)

Recompute runs at every plan generation and whenever a race is added,
edited or deleted. Merge new computation against stored rows by week:
- **Weeks 1–2 (current and next): pinned.** Reuse the stored row unchanged,
  UNLESS a race was added/moved/removed inside those two weeks, or the
  current LOAD FLAG / a "too hard" check-in applies — then the affected week
  becomes a **hold**: band lowered to last-7 km ± 10%, block position kept,
  and the block resumes afterwards.
- **Weeks 3–8: firm.** Keep stored phase and block_position; volume band may
  move at most ±10% towards the new computation.
- **Beyond 8: fuzzy.** Fully replaced by the new computation.
- Past weeks are never rewritten.

## 5. Consumers

- **Weekly generation** (`lib/weeklyPlan.ts`): replace the race_goal /
  getTrainingPhase summary and the streak-based "Mesocycle:" line with a
  SEASON POSITION section from the week's row: phase, block position, volume
  band, focus, next race (name, distance, date, priority, weeks away), any
  race inside the week with its priority, and the stability level. The LOAD
  FLAG line stays. The tool schema is unchanged. Rules in the TRAINING RULES
  block: prescribe running volume inside the band; `down`/`recovery` weeks
  get at most one quality session; B race weeks get the mini-taper; C races
  replace the day's quality session.
- **Dashboard / Plan / Settings** chips and phase cards read the current
  week's season row and the next race (replace all getTrainingPhase uses).
- **Voice check-in** (`lib/voiceCheckin.ts` briefing + `lib/elevenlabs.ts`
  prompt): the `race_goal` dynamic variable becomes a season line ("Peak,
  week 2 of 3 — Manchester Half (A) in 3 weeks; parkrun (C) this Saturday").
  Add TAPER AND RACE WEEK rules to the agent: never propose adding volume or
  intensity; ask about race-day logistics (travel to the race, start time —
  these become calendar_additions), sleep and any niggle; reassure that
  feeling flat in taper is normal. On the Sunday after an A or B race: open
  by asking how the race went, capture finish time and a sentence of notes
  into `result_time` / `result_notes` via a new proposal field, and confirm
  the coming recovery week. Analysis prompt: in taper/race weeks proposals
  may only reduce or move load, never add it.
- **trainingPhase.ts**: delete once nothing imports it.

## 6. UI

- **Settings → Races**: replaces the single race form. List sorted by date
  with priority chip (A/B/C), distance, date, target; add/edit/delete; a
  result field appears for past races. Dashboard quick action "Add a goal
  race" → "Races".
- **Season screen** (`/season`, secondary, back to Plan; linked from the Plan
  week-summary card): one row per week for 35 weeks — week commencing, phase
  chip, block position, volume band, race marker with priority; current week
  highlighted; stability shown by tone (pinned solid, firm normal, fuzzy
  dimmed) with a one-line legend. Read-only. A banner when two A races sit
  within 6 weeks.
- **Plan week summary**: one line of position, e.g. "Build · week 2 of 3 ·
  9 weeks to Manchester Half".

## 7. Docs

REQUIREMENTS.md §3.15 (season plan, v3 Must); DESIGN.md §8e (data helpers,
server actions, season row shape for the UI); COACH.md §5 gains one sentence:
"Phase, block position and volume band arrive from the season plan — apply
this section's rules to that position; do not re-derive it."
