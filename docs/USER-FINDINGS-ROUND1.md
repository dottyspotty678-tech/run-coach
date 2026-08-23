# User findings — round 1 (from the real user, testing on iPhone)

## U1 — CRITICAL (data correctness): all Strava activities treated as running
Every aggregation currently sums all activities regardless of `type`:
running distance totals (Today snapshot, Activity page 7/28-day figures and
chart), the weekly-km training summary sent to Claude, and day-completion
ticks. A bike ride or gym session inflates "running" volume and skews the
generated plan.

Required behaviour:
- Running distance/pace figures must count ONLY runs (Strava `type` of
  `Run` / `TrailRun` / `VirtualRun`).
- Non-run activities still matter: surface them as supporting/base training —
  in the training context sent to Claude (e.g. "plus 2 non-running sessions:
  1 ride 40km, 1 weight training"), in the Activity list (clearly labelled,
  no pace), and in completion ticks only where the planned session is a
  matching non-run type.

## U2 — NEW REQUIREMENT: two strength-training days per week (gym-based)
Every generated weekly plan must include exactly two strength sessions:
one on a weekday and one on a weekend day, defaulting to TUESDAY and
SATURDAY unless the calendar makes those impossible (then the nearest
sensible weekday/weekend day). They are sessions in the plan (with
title/detail/why like any other), sized sensibly around the running —
short strength work can share a day with an easy run.

User decision (explicit): strength sessions ALWAYS assume access to an
actual gym — never prescribe hotel-room/bodyweight-only variants. When
travelling, assume a gym is available (hotel or nearby).

Implementation notes for the fix round:
- Check `lib/planTypes.ts` SESSION_TYPES — add a `strength` type if absent,
  and give it colour/badge treatment in the session UI components.
- Update the generation prompt/tool schema to require the 2-per-week rule
  (Tuesday + Saturday default, gym-based) and validate it in the response
  guards.
- Update docs/REQUIREMENTS.md §training plan to record this as a v1 Must.

## U3 — NEW REQUIREMENT: ground training advice in the evidence base
The user supplied a curated scientific evidence base, now at
`docs/evidence-base.md` (consensus statements and meta-analyses covering
training intensity distribution, strength training for running economy,
nutrition, hydration and REDs safety).

Required behaviour (per the original architecture decision: grounding
informs the output silently — no citations shown in the app):
- Distil the evidence base into a concise principles block embedded in the
  weekly-plan generation prompt as a new composable context section, e.g.:
  ~80% of running volume at low intensity (polarised distribution);
  strength training 2x/week improves running economy (aligns with U2);
  never recommend aggressive calorie deficits alongside high mileage
  (REDs safety — reinforces the existing no-calorie-counting rule);
  fuelling/hydration guidance stays qualitative.
- Keep `docs/evidence-base.md` as the source of truth for future updates;
  the distilled block should cite which items it draws from in code
  comments only.

## U4 — NEW REQUIREMENT: Context & feedback capture
The user needs somewhere in the app to record (a) current injuries or
niggles and (b) how the last week of sessions felt. Both must feed the
weekly plan generation as a new composable context section, so the plan
respects injuries (e.g. reduce impact, avoid intervals) and responds to
subjective feedback (e.g. "last week felt too hard" → ease the load).

Behaviour:
- **Injuries**: a persistent free-text field ("Current injuries / niggles")
  that stays until the user edits or clears it. Shown back in the UI so it's
  obvious what the planner believes.
- **Weekly feedback**: a short free-text entry tied to the week it describes
  (keyed by week_start_date, editable until the next plan generates). Recent
  entries (last 2-3 weeks) go into the generation context, most recent
  weighted heaviest.
- Placement: the user asked for a tab. The designer decides the best
  navigation treatment (sixth tab vs a prominent card on Today linking to a
  dedicated screen) — but capture must be at most two taps from open, and
  dead-simple: this is a 30-second Sunday-evening jot, not a form.
- New table(s) in the schema migration; prompt builder gains a
  "CONTEXT FROM THE RUNNER" section; REQUIREMENTS.md updated as v1 Must.

Roadmap note (explicit user decision): this feature is the future home of
an ElevenLabs voice-agent capture flow ("tell the coach how the week went")
— NOT in this build. Design the data model so a voice transcript could
populate the same fields later.
