# User findings — round 2 (new requirements from the real user)

## U5 — Historical injuries
The Check-in screen currently captures only *current* injuries. The user
also wants a record of past injuries so the planner is permanently cautious
where history warrants it (e.g. a recurring calf strain two winters ago
should temper how aggressively speedwork ramps, even when currently
healthy).

Behaviour:
- A list of past injuries: free-text description + rough period (free-text
  is fine, e.g. "calf strain, winter 2024, ~6 weeks off"). Add/edit/delete.
- Lives on the Check-in screen alongside current injuries, visually
  secondary (it changes rarely).
- Feeds generation as background context, clearly distinguished from
  current injuries: current = "work around this now"; historical =
  "be structurally cautious about this".

## U6 — Manually logged sessions (not on Strava)
Some sessions never reach Strava (gym strength work, treadmill runs
without a watch, five-a-side, etc.). Today they're invisible: training
load reads low, strength sessions never tick complete.

Behaviour:
- A simple "Log a session" form: date (default today), type (same
  categories as the plan's session types plus a free-text other),
  duration in minutes, optional distance km for runs, optional short note.
- Manual entries merge into everything Strava entries feed: the Activity
  list (labelled "logged manually"), training-load context for generation,
  and type-aware completion ticks (a manually logged gym session ticks a
  strength day).
- Run-type manual entries WITH a distance count toward running km;
  everything else counts as supporting training only (consistent with U1).
- Editable/deletable (mistakes happen); Strava remains the source of truth
  where both exist — no de-duplication logic in v1, the user just avoids
  double-logging.

Implementation notes:
- New tables (e.g. `injury_history`, `manual_activities`) — do NOT shoehorn
  manual sessions into `strava_activities` (its PK is the Strava external
  id). Merge at the data-helper layer (components/data.ts) so every
  consumer (aggregations, ticks, context builder) sees one unified stream.
- Entry points: "Log a session" from the Activity screen (primary) and
  ideally the Today hero when today's session is unticked; injury history
  from Check-in.
- Schema migration block appended as "-- Round 2 migration"; REQUIREMENTS.md
  updated (v1 Musts, "added in round 2").
- Voice-agent note: like U4, model the data so a future voice flow can
  populate it.

## U7 — Plan review-and-revise loop
After a plan is generated the user wants to give feedback ON THAT PLAN and
trigger one revision that incorporates it, before treating the plan as
final.

Behaviour:
- On the Plan screen, once a plan exists: a "Suggest changes" affordance —
  short free-text ("move the long run to Sunday", "too many hard days") +
  a Revise action.
- Revision = a regeneration whose prompt ADDITIONALLY includes: the current
  plan (structured JSON), and the user's revision notes, with an explicit
  instruction to change only what the feedback requires and keep everything
  else as stable as possible (dates, session structure, meals not
  implicated).
- The revision note is stored with the week's plan (audit: what was asked),
  and shown until the next generation.
- Flow framing in the UI: generate → review → revise → done. Not a hard
  one-revision limit — the existing rate limits (2-min gap, 8/day) already
  bound cost — but the UI should present revise as the finishing step, not
  an infinite loop.
- Voice-agent note: this is the third capture surface that a future voice
  flow would feed.
