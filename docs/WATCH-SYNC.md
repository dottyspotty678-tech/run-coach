# Watch sync — planned workouts to intervals.icu (→ Coros)

The confirmed week lands on the runner's watch. intervals.icu is the bridge:
it has a documented write API for planned workouts and pushes the coming
week's plan to Coros whenever events are added, edited or deleted (the runner
has already linked Coros in intervals.icu and holds an API key). User
decisions (20 Sep 2026): push runs as STRUCTURED workouts and gym days as
simple WeightTraining events, no rest days; structured steps with pace
targets from the calibration; default start times weekdays 18:30 / weekends
09:00; push on check-in confirm AND re-push on any later change to that week.

## 1. intervals.icu API facts (verified from their forum guides)

- Auth: HTTP Basic, username `API_KEY`, password = the key. Athlete id `0`
  = the key's owner. Env vars: `INTERVALS_ICU_API_KEY` (required),
  `INTERVALS_ICU_ATHLETE_ID` (optional, default `0`). The runner adds the key
  in Vercel themselves; it is never committed.
- Create/update: `POST https://intervals.icu/api/v1/athlete/{id}/events/bulk?upsert=true`
  with an array of events. Upsert matches on `external_id` only.
- Delete: `PUT https://intervals.icu/api/v1/athlete/{id}/events/bulk-delete`
  with an array of `{ external_id }` (missing ones are ignored).
- Event fields: `category: "WORKOUT"`, `start_date_local` ("2026-09-22T18:30:00",
  LOCAL time, no zone), `type` ("Run" | "WeightTraining" — camelCase, no
  spaces), `name`, `description` (workout text, parsed into steps),
  `moving_time` (seconds), `external_id`, optional `target: "PACE"`.
- Workout text syntax (description), one step per line starting `- `:
  `[duration|distance] [target]`, e.g. `- Warmup 10m 5:10-5:30/km Pace`,
  `- 5x` header then indented block lines, `- 2km 3:55-4:05/km Pace`,
  `- Recovery 2m 5:30/km Pace`, `- Cooldown 8m Z1 Pace`. `m` = minutes,
  `mtr` = metres, `km` = kilometres. Leave a blank line before and after a
  repeat block. Text before the first duration is the step name. Markdown is
  ignored by the parser (safe for a plain-prose fallback).
- Coros: the runner enables "upload planned workouts" in intervals.icu's
  Coros settings; intervals.icu then pushes ~a week ahead on every change.

## 2. Structured steps in the plan (generation schema change)

`TrainingDay` gains optional `steps: WorkoutStep[]` for running sessions
(session_type easy/tempo/intervals/long/race; not rest/strength/cross):

```ts
type WorkoutStep =
  | { kind: "step"; label?: string; minutes?: number; km?: number;
      pace_low?: string; pace_high?: string }           // "m:ss" per km
  | { kind: "repeat"; times: number; steps: WorkoutStep[] }; // depth 1 only
```

Rules for the coach (prompt): every running day gets steps — warm-up, the
work, recoveries, cool-down; paces come from the calibration in COACH.md §1
(easy 5:00–5:30, threshold 3:55–4:05, 5k ~3:28, etc.) written as ranges;
each step has exactly one of minutes/km; the steps' total must match
`duration_min` within ±10%. Validation: coerce (drop malformed steps, clamp
repeats to 1–20) rather than fail; a day with no usable steps falls back to
a single prose event. Old plans without steps still push as prose.

## 3. lib/intervals.ts (pure conversion + thin client)

- `eventsForWeek(days: TrainingDay[], weekStart): IcuEvent[]` — one event
  per pushable day: runs → `type: "Run"`, `target: "PACE"`, description from
  steps (text syntax above) or `detail` prose; strength → `WeightTraining`
  with the session text as description; rest/cross days → NO event (cross
  training is the runner's own thing). `external_id = runcoach:<date>`;
  `start_date_local` = date + 18:30 Mon–Fri, 09:00 Sat–Sun; `name` = title;
  `moving_time = duration_min * 60`.
- `pushWeek(weekStart)`: load the stored plan, build events, `bulk?upsert=true`,
  then `bulk-delete` the external ids for the week's remaining dates (so a
  day that became rest disappears from the watch). Record the outcome.
- Never throws to callers: returns `{ ok, pushed, deleted, error? }`.
- Unit test (node --test) for `eventsForWeek` and the step→text conversion
  (repeat blocks, pace ranges, minutes vs km, the fallback).

## 4. Triggers and status

- After the voice check-in APPLY step completes its regeneration, push that
  week. After every other successful `generateWeeklyPlan` (cron, manual,
  revise, pending-batch apply, coach), push the target week. Best-effort:
  a failed push never fails the generation.
- `watch_sync` table: `week_start_date` (PK), `pushed_at`, `events_pushed`,
  `last_error`. Migration block "-- Watch sync migration".
- Server action `pushWeekToWatch(week_start_date)` for a manual "Send to
  watch" button.
- UI: Plan week card shows a one-line status ("On watch · 3 runs, 2 gym ·
  synced 2 min ago" / "Not on watch yet" / the error) with a Send/Resend
  button; Settings → Connections gains an intervals.icu card (Connected when
  the env var is present; shows last push; a "Send this week" action).

## 5. Docs

REQUIREMENTS.md §3.16 (v3 Must); DESIGN.md §8f (event shape, status row,
server action names); `.env.local.example` gains the two env vars.
