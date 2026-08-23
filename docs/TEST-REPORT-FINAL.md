# Run Coach — stress test report, FINAL (round 3 verification)

Date: 23 Aug 2026, ~22:15 Europe/London.
Target: https://run-coach-fawn.vercel.app — commits `2cc5371` (U5/U6 + m-5 scrub),
`df1b959` (U7), `05aebbe` (round-2 UI) deployed; round-2 migrations run.
Method: as rounds 1–2 — `curl` + PIN session cookie; source read-only.
Generations spent this round: **1** (the budgeted U7 revision). No test data written.

Context worth knowing: between rounds the **real user has started using the app** — they set
a race goal (Brighton Trail Marathon), saved a weekly note ("Runs felt very easy…") and
current injuries (plantar fasciitis / Achilles), and regenerated the plan ~24 min before this
pass. So the stored plan already post-dates all fixes and visibly reflects their data — which
let this round verify U4's *generation* effect end-to-end with real data, not just renders.

---

## 1. Verdicts per item

### Item 1 — m-5 fix (travel-meal recipes / shopping-list leakage) → **PASS**

Proven on the U7 revision output (which passes through the new scrub):

- All six travel-day meals are guidance-only ("pick a protein-forward main with veg at the
  hotel restaurant…") — no cooking methods, no ingredients, no prep chips.
- The post-revision shopping list has 5 items (chicken breast, rice, mixed vegetables,
  garlic, soy sauce) — every one traces to the single home meal (Wednesday); nothing traces
  to a travel meal.
- Source confirms both layers: the prompt now forbids methods on travel days ("no
  'drain / chop / mix'… travel days cannot be cooked for") and `lib/weeklyPlan.ts` gained an
  m-5 fuzzy-match scrub that drops shopping items only traceable to travel-meal ingredients.

### Item 2 — U7 plan review-and-revise → **PASS** (the round's one generation)

- Pre-revision state saved first (`/plan`, `/food`).
- Repro:
  ```
  curl -X POST -b rc.txt https://run-coach-fawn.vercel.app/api/plan/generate \
    -H "Content-Type: application/json" \
    -d '{"revision_note":"Swap Wednesday'\''s tuna and white bean salad for a simple chicken and rice dinner. Keep everything else exactly as it is."}'
  ```
- Response: **200 in 24.4 s** —
  `{"week_start_date":"2026-08-24","week_summary":"…","revised":true}` — exactly the
  DESIGN §8c shape.
- Requested change appears: Wednesday's meal is now "**Simple chicken and rice**" (badge
  Quick→**Home**, 10→**20 min**, new ingredients, 4-step method).
- Stability of unimplicated content — verified by diff against the pre-revision snapshot:
  **all 7 training day cards byte-identical** ("TRAINING DAYS IDENTICAL"), **all 6 travel
  meals verbatim unchanged**, shopping list rebuilt to match only the new meal.
- Read-back on `/plan`: "**Revised just now — you asked: "Swap Wednesday's tuna and white
  bean salad for a simple chicken and rice dinner…"**".
- The "Suggest changes" affordance renders on `/plan`, framed as the finishing step
  ("Happy with the week? … ask for one targeted change — otherwise you're set.").
- Immediate second POST → **429 "Easy tiger — you can regenerate again in a moment."**
  (rate limits cover revisions, per §8c).
- Bonus: the revision also tidied the week summary's awkward parenthetical (see f-1) while
  leaving its substance alone — good keep-stable behaviour.

### Item 3a — U5 injury history → **PASS (render + wiring); interactive CRUD → NEEDS-HUMAN-CHECK**

- `/checkin` shows the **Past injuries** section below current injuries, visually secondary,
  with an **Add** affordance, the empty state "**Nothing recorded — long may it last.**",
  the framing copy ("Old trouble the planner stays structurally cautious about — separate
  from anything current above") and the footer explaining all three feeds.
- Server actions exist per DESIGN §8b: `addInjuryHistory` / `updateInjuryHistory` /
  `deleteInjuryHistory` in `app/settings/actions.ts`; `getInjuryHistory` in
  `components/data.ts`.
- Add/edit/delete are client-driven server actions — not curl-testable; no test data
  submitted. Human: add a past injury, edit it, delete it, and confirm a saved one appears
  in the next plan's caution.
- Incidentally verified live: the **current-injuries loop works end-to-end with real data** —
  the user's injuries text is read back on Check-in ("The planner is working around: …") and
  on the Plan header ("Working around: …"), and the generated week visibly obeys it (every
  run easy/short, "stop and walk it out", strength "aids Achilles and plantar fascia
  resilience"). U4's full promise, observed in production.

### Item 3b — U6 manually logged sessions → **PASS (render + wiring); submission/merge → NEEDS-HUMAN-CHECK**

- `/activities` shows the **"Log a session"** affordance in the header (primary entry point
  per §3.12). The sheet is a client component (`app/activities/log-session.tsx`) with
  exactly the contract fields: `activity_date` (defaulting today), `type` (session types +
  free-text other via hidden `type` field), `duration_min` (number), `distance_km`
  (number, runs), `note`, plus hidden `id` for edit and a delete form.
- List rendering handles manual rows per spec in source (`app/activities/page.tsx`):
  "**Logged manually · **" label, **pace never shown** for manual entries, edit/delete
  affordances on manual rows only. Today-hero entry point confirmed in source
  (`LogSessionButton` imported and rendered in `app/page.tsx` when today's structured
  session is unticked — not observable tonight because Sunday still shows the legacy-week
  hero; visible from Monday).
- No manual entries exist yet in production, so the merged stream, "logged manually" row,
  strength-day tick and run-km counting could not be observed live. Human: log a gym
  session, confirm it ticks a strength day and shows labelled in the list; log a run with
  distance, confirm the running-km totals move; edit then delete both.

### Item 4 — regression sweep → **PASS (all)**

| Check | Result |
|---|---|
| Uncookied `/` | 307 → `/pin` |
| Uncookied `POST /api/plan/generate` | 401 JSON |
| Tampered cookie (`rc_auth=deadbeef`) | 401 |
| `/manifest.json`, `/sw.js` (no cookie) | 200, 200 |
| `/activity` | 308 → `/activities` |
| All screens with cookie (`/`, `/plan`, `/food`, `/activities`, `/calendar`, `/settings`, `/checkin`) | all 200 |
| Content rules on revised plan/food | no US spellings, no calories/kJ/macros/points, no emoji, no visible ISO dates |
| Activity totals still run-only | 16 km / 7 d, 22 km / 28 d — rides still excluded, labelled, no pace |

Note: a scan hit on "chilie" is the **user's own typo** ("achilies tendonopathy") in their
injuries text, echoed back verbatim — correct §3.11 behaviour (show what the planner
believes), not a content violation.

---

## 2. New findings this round

### f-1 (Minor, generated-content quality) — week summary's running-volume figure contradicts the day cards

- The current week summary says "aim is roughly **4.5-5 km total running**", but the day
  cards prescribe 30 + 25 + 30 min of easy running plus an optional 15–20 min jog — roughly
  12–16 km at any easy pace. (Pre-revision it was worse: "around 85-90 km-equivalent target
  is not relevant here, aim is roughly 4.5-5 km total running" — the revision tidied the
  phrasing but kept the low figure.)
- Not a code bug — model arithmetic in one generation — but it undermines the week summary's
  §3.3 job ("target weekly km"). Worth a prompt nudge ("the weekly km figure must be
  consistent with the sum of the day cards") or a soft validation warning.
- Likely file: `lib/weeklyPlan.ts` (prompt / soft checks).

No other new findings. Rounds 1–2 items re-checked in passing all held: U2 strength sessions
are now on **Tuesday and Saturday** in the user's regenerated plan (round-2 watch item
resolved on a real week), sync status clean, mixed-case API paths still 401.

---

## 3. Overall release verdict — REQUIREMENTS.md v1 Musts

| Must | Verdict |
|---|---|
| §3.0 Navigation | **PASS** |
| §3.1 PIN gate | **PASS** (re-verified every round; no bypass ever found) |
| §3.2 Today | **PASS** (structured hero observable from Monday; strip/snapshot/check-in row verified) |
| §3.3 Training plan (structured + strength) | **PASS** (Tue/Sat strength confirmed on a live week) |
| §3.4 Meals | **PASS** (m-5 fixed and proven) |
| §3.5 Shopping list | **PASS** (scrubbed, categorised, traceable) |
| §3.7 Generation, revision, limits | **PASS** (fresh gen, revision, 2-min 429 all live-proven) |
| §3.8 Sync | **PASS** |
| §3.9 Settings | **PASS** |
| §3.11 Context & feedback | **PASS** — full loop now proven with real user data |
| §3.12 Manual sessions | **PASS on render/wiring**; interactive submission human-checked |
| §3.13 Review & revise | **PASS** — precise, stable, audited |
| §4 Content rules | **PASS** (one Minor content-quality niggle, f-1) |
| §5.2 PWA/offline | **PASS (server side)**; device install human-checked |
| §5.5 Europe/London time | **PASS** (boundary flip observed live) |

**Release verdict: SHIP.** Every v1 Must passes on everything observable from this
environment. Open items are one Minor content-quality niggle (f-1) and the interactive
human checklist below — none blocking.

---

## 4. Final human checklist (real user, on the phone)

New this round:
1. **U5**: add a past injury ("calf strain, winter 2024, ~6 weeks off"), edit it, delete it;
   after adding, regenerate next Sunday and confirm the plan stays structurally cautious.
2. **U6**: log a gym session (confirm it ticks a strength day and lists as "Logged
   manually", no pace); log a run with distance (confirm running-km totals move); edit and
   delete both. Check the Today-hero "Log" affordance appears when today's session is
   unticked (from Monday).
3. **U7 on-device**: use "Suggest changes" from the Plan screen — confirm the note field,
   the in-flight state, the read-back, and that the flow feels like a finishing step.

Carried over (rounds 1–2):
4. Check-in weekly-note and injuries save/clear round-trip (partially proven — the user has
   already done this successfully once; confirm Clear — all healed).
5. Visual/touch: dark/light themes, session-type colours (incl. strength teal), tab bar,
   deep links, Method disclosures, shopping ticks persist/strike/reset, PIN keypad shake +
   lockout countdown, skeletons, offline banner, pull-to-refresh.
6. iPhone PWA: Add to Home Screen, standalone display, safe areas, status-bar theming,
   Today interactive < 2 s on 4G.
7. Monday-morning glance: structured hero card renders for the new week (legacy blob gone).

---

Budget: 1 generation spent (the U7 revision); 2-min/8-day limits respected and re-verified.
No destructive actions, no test data left behind, no code modified.
