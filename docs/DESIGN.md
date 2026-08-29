# Run Coach — design system (v2 overhaul)

Companion to `REQUIREMENTS.md`. This document is the contract for the UI layer: visual
language, tokens, component inventory and navigation. The implementation lives in
`app/globals.css` (tokens), `app/layout.tsx` (font wiring), `components/` (shared UI) and
the route files.

---

## 1. Visual direction: "Negative split"

Run Coach is opened twice: for 20 seconds in a hotel corridor at 21:40, and for 10 calm
minutes on a Sunday evening. Both moments happen at night, on a phone, by a tired person
who wants an answer, not an experience. A negative split — running the second half faster —
is also a pun on the inverted, dark-first palette. The design world is the **timing board
and the split sheet**: stadium clocks, finish-line printouts, the split table on a race
result.

- **Dark-first: a floodlit track after hours.** The dark theme is the primary design
  target. Blue-black ground (not neutral near-black), chalk-white ink, slate card
  surfaces. Light mode is a genuine daylight translation — cool paper, not warm cream.
- **The split board is the signature.** Every figure in the app — paces, km, minutes,
  dates in tables, the PIN pad, chart labels, the hero session title — is set in a
  timing-board monospace (Azeret Mono). Data rows read like race splits: label left,
  mono figure right, hairline rules. Everything around the figures stays quiet.
- **One accent: finish-tape pink.** `--accent` is fluorescent finish-line tape. It marks
  primary actions, the active tab's lane indicator and the today marker — nothing else.
  The `race` session colour deliberately shares the accent hue: race day is the point of
  the whole app. Warnings are scoreboard amber, like an amber stadium board message.
- **Structure encodes state.** Today is a 3px accent lane bar on the row's left edge, not
  a tinted fill. The hero card carries a 3px "start line" rule in the session's colour.
  Chips are rectangular timing tags (mono, uppercase, hairline border), not pills.
- **Colour = session type, always.** Each of the eight session types owns a fixed hue used
  identically in badges, table rows and the volume chart. Badges always pair colour with a
  text label (colour-blind safe). No gradients, no shadows, no illustration.

## 2. Colour system

All colours are CSS custom properties defined in `app/globals.css` under `:root` and a
`prefers-color-scheme: dark` override, mapped to Tailwind utilities via `@theme inline`.
The variable names are stable API — components never hard-code hex values.

### Core palette

| Token          | Light                    | Dark                     | Use |
|----------------|--------------------------|--------------------------|-----|
| `--bg`         | `#EEF1F6` cool paper     | `#0C111B` track night    | page background |
| `--surface`    | `#FFFFFF`                | `#141A26` slate lane     | cards |
| `--raised`     | `#E2E7EF`                | `#1D2534`                | chips, secondary surfaces, keypad keys |
| `--ink`        | `#17202E`                | `#F0F3F8` chalk          | primary text |
| `--ink-2`      | `#515D70`                | `#96A0B5`                | secondary text |
| `--ink-3`      | `#8792A3`                | `#64708A`                | tertiary/disabled text |
| `--line`       | `rgba(23,32,46,.12)`     | `rgba(240,243,248,.09)`  | hairline borders |
| `--accent`     | `#D11D62`                | `#FF4F87` finish tape    | primary buttons, active tab, today marker, links |
| `--on-accent`  | `#FFFFFF`                | `#180510`                | text on accent |
| `--accent-soft`| `rgba(209,29,98,.09)`    | `rgba(255,79,135,.13)`   | accent-tinted fills |
| `--ok`         | `#178A4C`                | `#45D483`                | success, completed ticks |
| `--warn`       | `#96660A`                | `#F5B84D` scoreboard amber | stale/warning banners |
| `--danger`     | `#C33B3B`                | `#FF7676`                | errors, destructive actions |

### Session-type colours (fixed across the app)

Each has a strong tone (`--s-*`) for text/icons and a soft tone (`--s-*-soft`) for fills.
The accent moved from orange to pink in this overhaul, so `race` moved with it (the
"race shares the accent hue" rule is deliberate and kept).

| Session     | Light strong | Dark strong | Abbrev (tables) |
|-------------|--------------|-------------|-----------------|
| `rest`      | `#66717F`    | `#8C97A8`   | Rest |
| `easy`      | `#1F8A4D`    | `#4FD07F`   | Easy |
| `tempo`     | `#93720A`    | `#FFD24A`   | Tmp |
| `intervals` | `#CE3B3B`    | `#FF6E6E`   | Int |
| `long`      | `#1D6FC2`    | `#57ABFF`   | Long |
| `cross`     | `#6A48D8`    | `#B08CFF`   | XT |
| `strength`  | `#0E8578`    | `#3ED3C4`   | Str |
| `race`      | `#D11D62`    | `#FF4F87`   | Race |

Badges are always colour + text label, never colour alone (colour-blind safe).

## 3. Typography

Two faces, self-hosted at build time via `next/font/google` (wired in `app/layout.tsx`,
exposed as `--font-body` and `--font-digits` in `app/globals.css`):

- **Hanken Grotesk** — body and UI copy. Warm, highly legible on a phone at night.
- **Azeret Mono** (500/600/700) — the timing-board face. Carries every figure in the app
  plus display titles and board labels. It is content, not decoration: the mono appears
  wherever a number does the talking.

Roles (utility classes in `app/globals.css`):

- **`.display`** — mono 600, −0.035em: hero session title (24/31), screen-date header
  (20, uppercase), expanded plan-row titles (16/22).
- **Title 22/28 bold (body face)** — screen titles.
- **Headline 17/24 semibold (body face)** — card titles, recipe names.
- **Body 15/22 regular** — detail text, instructions.
- **Footnote 13/18 regular** — metadata, timestamps, banner copy.
- **`.overline`** — mono 10.5/600, uppercase, +0.09em: section labels, column heads,
  stat captions, tab labels.
- **`.tabular`** — mono with `tabular-nums`, −0.02em: every inline figure (paces, km,
  minutes, dates in tables, PIN keys, chart labels, quantity columns).

Headings carry −0.015em tracking globally.

## 4. Spacing, radius, elevation

- 4 px base grid. Screen padding 16 px; card padding 16 px; section gap 24 px; card gap 12 px.
- Radius: cards 12 px; inputs 10 px; buttons 8 px; chips/timing tags 5 px; keypad keys and
  shopping ticks are rounded squares. Pills are retired.
- Elevation: none. Separation is surface tone + 1 px `--line` hairlines. The only thick
  rules are semantic: the hero start line (3 px, session colour), the today lane bar
  (3 px, accent), the active-tab lane indicator (2 px, accent).
- Tap targets ≥ 44 × 44 px everywhere (tab items, keypad, checkboxes, steppers, chips).
- Keyboard focus: global `:focus-visible` ring in `--accent`.
- Motion: skeleton pulse, spinner, PIN shake only; `prefers-reduced-motion` kills the
  pulse and shake and slows the spinner.
- Safe areas: root layout pads `env(safe-area-inset-top)`; the tab bar pads
  `env(safe-area-inset-bottom)`; content reserves tab-bar height + inset at the bottom
  (`.pb-tabbar`).
- Mobile-first at 390 px, usable at 320 px (single column throughout; `max-w-lg` centred on
  desktop).

## 5. Component inventory

| Component | File | Notes |
|---|---|---|
| Tab bar | `components/tab-bar.tsx` | V2: 4 tabs (Dashboard · Plan · Nutrition · Settings), blur surface, active = accent + 2 px lane indicator, mono uppercase labels; tapping active tab scrolls to top; hidden on `/pin`. |
| Card | utility classes (`.card`) | Surface, radius 12, hairline border. |
| Session badge | `components/session.tsx` | Timing tag: soft fill + strong text + hairline border, mono uppercase. Fixed colour per type. |
| Meal-type badge | `components/session.tsx` | v1 legacy rendering only (Home / Eating out / Quick) — the v2 meal model has no meal types. |
| Context chip | `.chip` utility | Header chips: "Travel day", "Race week", "6 weeks to …". |
| Banner | `components/banner.tsx` | Variants: warn (stale/disconnected), error, info, offline; `quiet` prop (V2 Dashboard) drops the fill for tinted text + hairline so banners sit below the hero visually. |
| Offline banner | `components/offline-banner.tsx` | Client; listens to online/offline events. |
| Dinner card (Dashboard) | rendered in `app/page.tsx` | V2: shown ONLY when today is an away day with a planned prep-ahead meal; links to Nutrition. Home days show no meal card. |
| Volume lookback card | rendered in `app/page.tsx` | V2: 7-day running km (run-only, U1) + planned-sessions-done summary; opens `/activities` (the relocated Activity history). |
| Quick actions grid | rendered in `app/page.tsx` | V2: 2x2 — Log a session (sheet), Add a goal race (`/settings#race`), Add a check-in (`/checkin`), Update training plan (`/plan?edit=1`). |
| Plan table | `app/plan/plan-table.tsx` | V2: Date \| Volume \| Detail rows, today first then forward (past days dimmed at the end); tap to expand the full session card. Volume = "15 km" / "45 min" / "Gym" / "Rest". |
| Plan edit mode | `app/plan/plan-table.tsx` | V2: per-row session-type quick-pick + free-text (`addPendingChange`), whole-week instruction, inline check-in note (`savePendingCheckin`), pending list with per-item Remove and Clear all, ONE "Apply changes — regenerate" → POST `{apply_pending: true}` (~30 s state, 429/500 surfaced). Replaces the round-2 Suggest-changes card. Deep-linked from the Dashboard via `?edit=1`. |
| Away meal card | `app/food/page.tsx` | V2: `<details>` row — date + recipe + prep time, expanding to ingredients (item \| quantity) and method. |
| Shopping list | `app/food/shopping-list.tsx` | Client; grouped by category with the sketch's Item \| Volume columns (`quantity_note` right-aligned); localStorage ticks keyed by week + generated_at; checked sink + strike; "Reset ticks". |
| Generate/regenerate | `components/generate-plan.tsx` | Confirm sheet when replacing; in-flight spinner label "Planning your week… (about 30 seconds)"; error + retry. |
| Sync button(s) | `app/settings/connections.tsx`, secondary-screen sync buttons | Combined sync = both providers, independent per-provider results. |
| Tag input | `app/settings/food-form.tsx` | Type + add, tap to remove; writes hidden comma-joined field (keeps server-action field names). |
| Stepper | `app/settings/food-form.tsx` | Household size 1–6. |
| PIN keypad | `app/pin/pin-pad.tsx` | 4 dots, 0–9 + delete, auto-submit on 4th digit, shake on 401, countdown lockout on 429. |
| Check-in forms | `app/checkin/checkin-forms.tsx` | Two textareas, one Save each: weekly note (keyed to the week containing today) and persistent injuries with "Clear — all healed". Fix round 1, U4. |
| Injury history list | `app/checkin/injury-history.tsx` | Round 2, U5. Visually secondary list under current injuries: description + period rows, inline add/edit forms, in-place delete confirm. |
| Log-session sheet | `app/activities/log-session.tsx` | Round 2, U6. Bottom sheet: date, session-type quick-pick chips + free-text "Other", duration, distance (run-ish types only), note. Entry points: Dashboard quick action ("tile" appearance), Activity header (and empty state), Dashboard hero when today's session is unticked (pre-selects the type). `ManualActivityActions` adds Edit/Delete to manually logged rows only; manual rows carry a "Logged manually" label and never show pace. |
| Skeletons | `loading.tsx` per route + `.skeleton` utility | Reserve final layout space; visible < 500 ms. |
| Empty states | per screen | Icon-free, one sentence + one action, per REQUIREMENTS §3 / REDESIGN-V2. |

Retired in V2: the 7-day week strip and 3-tile snapshot row (Dashboard now carries the
volume card + quick actions), the Today check-in row (quick action instead), the Food
Meals ⇄ Shopping segmented control (one scrolling Nutrition screen), and the round-2
Suggest-changes card (merged into Plan edit mode).

## 6. Navigation map (V2 — docs/REDESIGN-V2.md)

Bottom tab bar (always visible except on `/pin`):

1. **Dashboard** — `/` (PWA start URL)
2. **Plan** — `/plan` (table + edit mode; `?edit=1` opens edit mode directly)
3. **Nutrition** — `/food` (away-day recipes, then the shopping list)
4. **Settings** — `/settings`

Secondary screens (back affordance in header, no tab highlight):

- **Activity history** — `/activities` (relocated from the v1 tab; list, 8-week chart and
  Log a session all kept), reached from the Dashboard volume card.
- **Calendar list** — `/calendar`, reached from Plan → calendar strip → "Full calendar" and
  Settings → Connections.
- **Check-in** — `/checkin`, reached from the Dashboard quick action, the Plan week-summary
  link, the Settings row, and the Sunday nudge banner.
- **PIN screen** — `/pin`, rendered by middleware for unauthenticated requests; verifies via
  `POST /api/pin/verify` with `{ pin: string }` → 200 (cookie set, redirect `/`), 401 (wrong),
  429 + `{ retryAfterSeconds: number }` (lockout).

Cross-links: Dashboard hero → none (it *is* the answer); Dashboard dinner card →
`/food#d{date}` (away days only); volume card → `/activities`; quick actions → log-session
sheet, `/settings#race`, `/checkin`, `/plan?edit=1`; sync banners → `/settings#connections`;
Activity empty state → `/settings#connections`.

**Sunday-evening state (V2).** From Sunday 17:00 the app shows the upcoming week (§3.3
boundary). With the v1 week strip retired, a single quiet banner is the one voice: "Next
week's plan is ready — review it" (→ `/plan`) once the plan exists, or "Next week's plan
generates this evening" before the cron lands. The hero still shows *today's* (Sunday's)
session from the ending week.

## 7. Interfaces the backend must honour (UI already reads these)

- `lib/planTypes.ts` — structured plan types (`TrainingDay`, `MealEntry`, `ShoppingItem`)
  exactly as REQUIREMENTS §3.3–3.5; the UI falls back gracefully when
  `training_plan_json`/`shopping_list_json` are absent or `meal_plan_json` entries lack
  `meal_type` (old-format plans).
- Sync status: the UI reads a `sync_status` table shaped
  `{ provider: 'strava' | 'microsoft', last_synced_at: timestamptz | null, last_error: text | null }`
  and degrades silently (no banners) when the table does not exist yet.
- `POST /api/pin/verify` per §6 above.
- Week boundary: UI computes Monday-start weeks in Europe/London, switching to the upcoming
  week from Sunday 17:00 (REQUIREMENTS §3.3).

## 8. Context & feedback — backend interface (added in fix round 1, U4)

The backend half of Context & feedback is live; the designer builds the capture
UI (a tab or a Today card + screen — designer's call, ≤ 2 taps from open) on
these interfaces. Same contract style as §7.

Data access (`components/data.ts`, server-side; both degrade silently — `null`
/ `[]` — until the fix-round-1 migration has run):

- `getRunnerContext(): Promise<{ injuries: string; updated_at: string } | null>`
  — the persistent "current injuries / niggles" free text. `null` when unset;
  show it back to the user so it is obvious what the planner believes.
- `getRecentFeedback(limit = 3, beforeWeek?: string): Promise<Array<{ week_start_date: string; feedback: string; updated_at: string }>>`
  — weekly feedback notes, most recent first. `week_start_date` is the Monday
  (YYYY-MM-DD) of the week the note describes. Pass `beforeWeek` to exclude a
  target week (the generator does).

Server actions (`app/settings/actions.ts`):

- `saveInjuries(formData)` — field `injuries` (free text). Empty string
  clears; the planner then reports "none". Persists until edited.
- `saveWeeklyFeedback(formData)` — fields `feedback` (free text) and optional
  `week_start_date` (any YYYY-MM-DD; snapped to its Monday; defaults to the
  current London week). Upsert per week, so the note stays editable; an empty
  `feedback` deletes the week's note.

Generation: the prompt gains a "CONTEXT FROM THE RUNNER" section combining the
injuries text and the last 3 feedback notes, most recent weighted heaviest.
Saved notes influence the next generation automatically — no extra wiring.

Roadmap note: both fields are plain free text so a voice-agent transcript
(ElevenLabs, out of scope) can be written through these same actions.

### Capture UI placement (designer decision, fix round 1)

The user asked for "a tab". Deliberately **not** a sixth tab, for three reasons:

1. **Usage shape.** Tabs are for destinations you visit most days; the check-in is a
   ~once-a-week, 30-second jot. A sixth tab would sit inert six days out of seven and dilute
   the five real destinations.
2. **Ergonomics at 320 px.** Six items shrink each tap target from ~64 px to ~53 px and crowd
   the labels — against the ≥ 44 px comfortable-target rule this system is built on.
3. **Reachability is what the user actually wants.** The chosen treatment beats a tab on the
   stated constraint (≤ 2 taps from open): a **persistent one-tap row on Today** (which also
   serves §3.11's "shown back clearly" requirement — it displays "Working around: {injuries}"
   every single day), a **Sunday nudge banner on Today** when the week's note is empty (the
   planning-ritual moment), plus links from the Plan week summary and Settings.

The capture screen itself is `/checkin` — a secondary screen (back affordance, no tab
highlight, like `/calendar`): two textareas and two Save buttons, nothing else. The weekly
note is keyed to `mondayOf(today)` — the week being *described* — deliberately not the
boundary week, so a note written on Sunday at 21:00 still refers to the week that just
happened. Injuries show a read-back line ("The planner is working around: …" /
"The planner believes you are injury-free") above the edit field, with a one-tap
"Clear — all healed" action.

## 8b. Injury history & manual sessions — backend interface (added in round 2, U5/U6)

Backend is live; the designer builds: an **injury history list** on `/checkin`
(visually secondary — it changes rarely) with add/edit/delete, a **"Log a
session" form** reachable from Activity (primary entry point) and ideally from
the Today hero when today's session is unticked, and edit/delete affordances on
manually logged rows. Same contract style as §7/§8.

Data access (`components/data.ts`; degrade silently until the Round 2
migration runs):

- `getInjuryHistory(): Promise<Array<{ id: number; description: string; period: string; created_at: string }>>`
  — past injuries, newest first. `period` is rough free text ("winter 2024,
  ~6 weeks off") and may be `""`.
- `getRecentActivities(days)` now returns ONE unified stream: Strava rows plus
  manual entries, newest first. Every row gained optional fields:
  `source?: "strava" | "manual"`, `manual_id?: number` (for edit/delete
  forms), `note?: string | null`. Manual rows have `external_id = -manual_id`
  (negative — safe React key, never collides with Strava ids),
  `average_pace: null`, and `name` set to the note when present. Label rows
  with `source === "manual"` as "logged manually"; never show pace for them.
  Aggregations, ticks (`sessionDone`) and the generation context already
  consume the merged stream — no extra wiring.
- `getManualActivities(days)` returns the raw manual rows
  (`{ id, activity_date, type, duration_min, distance_km, note, created_at }`)
  if the UI wants them unmerged.

Server actions (`app/settings/actions.ts`):

- `addInjuryHistory(formData)` — fields `description` (required), `period`
  (optional). `updateInjuryHistory(formData)` — `id` + same fields.
  `deleteInjuryHistory(formData)` — `id`.
- `addManualActivity(formData)` — fields `type` (required; a plan session
  type like "easy"/"strength", or free text like "football"), `duration_min`
  (required, positive integer), `activity_date` (optional YYYY-MM-DD, defaults
  to today in London), `distance_km` (optional; run-flavoured types with a
  distance count toward running km — everything else is supporting training),
  `note` (optional). `updateManualActivity(formData)` — `id` + same fields.
  `deleteManualActivity(formData)` — `id`.

Semantics: a manually logged gym session ticks a `strength` day; a manual run
ticks run days (and its distance, when given, counts in the running-km stats
and the generation context, flagged "logged manually" there). Strava stays the
source of truth where both exist — no de-duplication; the user avoids
double-logging. Both tables are free-text-friendly for the future voice flow.

## 8c. Plan review-and-revise — backend interface (added in round 2, U7)

Backend is live; the designer builds the "Suggest changes" affordance on the
Plan screen, framed generate → review → revise → done (revise is the finishing
step, not a loop — nothing hard-blocks a second revision; the §3.7 rate limits
bound cost).

API — same endpoint as generation:

- `POST /api/plan/generate` with JSON body `{ "revision_note": string }`
  (non-empty; trimmed; capped at 2000 chars server-side) revises the stored
  plan for the current boundary week. Without a body (or with an empty note)
  it is a normal fresh generation — the existing GeneratePlanButton behaviour
  is unchanged.
- Responses match generation: `200 { week_start_date, week_summary, revised: boolean }`;
  `429 { error }` (rate limits — the same 2-min/8-day budget covers revisions);
  `500 { error }` (real message; the stored plan is untouched on failure —
  generate-then-swap).
- Behaviour: the prompt gains a REVISION REQUEST block — the current stored
  plan as JSON, the note, and a keep-stable instruction (change only what the
  notes require; unimplicated days, meals and shopping items stay verbatim).
  Best-effort sync still runs first. If no plan exists for the week, the call
  degrades to a fresh generation.

Reading the audit trail (`WeeklyPlanRow` in `lib/planTypes.ts`, populated by
`getPlanForWeek`):

- `revision_note: string | null` — the note behind the CURRENT stored plan;
  show it on the Plan screen ("Revised: …") until the next generation.
- `revised_at: string | null` — when that revision happened (`generated_at`
  updates too). Both are null on a fresh generation and on pre-migration
  rows; render nothing when null.

## 8d. V2 backend interfaces — away/home engine, meal-prep model, batch editing

Contract for the v2 screens (docs/REDESIGN-V2.md). Same style as §7–§8c.

### Away/home status engine (governs MEALS; `is_travel` still governs TRAINING)

- `awayDatesForRange(events, dates)` in `components/data.ts` — pure function:
  pass `CalendarEventRow[]` (from `getEventsForWeek` or an equivalent query)
  and an ascending list of YYYY-MM-DD dates; returns the `Set<string>` of AWAY
  dates. Rules: hotel check-in/booking titles open a span until the day before
  the matching check-out (single-day check-ins still count one night);
  events whose `location` is not a home base (Manchester/London) mark
  [start … day before end] — so a same-day trip yields no away days; virtual
  locations (Teams/Zoom/…) count as no location; home is the default.
- `CalendarEventRow` gained `location?: string | null` (populated by the
  calendar sync after the V2 migration; null before).
- Dashboard "today's dinner card": show only when `awayDatesForRange(...)` for
  today contains today AND the plan has a meal for today (below).

### V2 meal model (`lib/planTypes.ts`)

- New plans store `meal_plan_json` as `AwayMealEntry[]`:
  `{ date, recipe_name, prep_time_min, ingredients: { item, quantity }[], method }`
  — one entry per away day in the plan week; `[]` when the week has none.
- Parse with `parseAwayMeals(plan)` → `AwayMealEntry[] | null`. Null means the
  row is v1/legacy format — fall back to the existing `parseMeals` /
  `parseLegacyMeals` renderers (do not break old rows). `[]` means a valid v2
  week with no away days → "No away days coming up — nothing to prep".
- Shopping list: unchanged shape `{ item, quantity_note, category }` — render
  `quantity_note` as the sketch's "Volume" column. Generation guarantees the
  list is exactly the away recipes' ingredients (server-side scrub).

### Pending changes + batch apply (Plan screen edit mode)

- Read: `getPendingChanges(weekStart)` in `components/data.ts` →
  `{ week_start_date, changes: PendingChange[], checkin_note, updated_at } | null`
  where `PendingChange = { id, date | null, requested_type | null, instruction | null }`.
  Null pre-migration or when nothing is queued.
- Server actions (`app/settings/actions.ts`):
  - `addPendingChange(formData)` — fields `date` (optional YYYY-MM-DD; omit
    for a general instruction), `requested_type` and/or `instruction` (at
    least one), optional `week_start_date` (defaults to the plan/boundary week).
  - `removePendingChange(formData)` — `id`, optional `week_start_date`.
  - `clearPendingChanges(formData)` — optional `week_start_date`.
  - `savePendingCheckin(formData)` — `checkin_note` (empty clears), optional
    `week_start_date`. Persists with the queue so it survives navigation.
- Apply: `POST /api/plan/generate` with `{ "apply_pending": true }` — one
  call that (a) writes the inline check-in through the weekly_feedback path,
  (b) fires ONE regeneration via the U7 revise semantics with the whole batch
  serialised into the revision context (keep-stable rules apply), and (c)
  clears the queue on success only. Empty queue → `400 { error }`. Same rate
  limits and generate-then-swap as every manual generation; response is the
  generation response plus `applied: true`. A plain `revision_note` in the
  same body is folded in as an extra general instruction.

## 9. States checklist (stress-tester map)

Every tab screen implements: **loading** (route `loading.tsx` skeletons), **empty** (specified
copy + action), **error** (route `error.tsx` with retry), **offline** (global banner + cached
render via service worker). Today additionally: no-plan card, stale-sync banner, disconnected
banners, Sunday plan-ready banner. Food additionally: all-travel shopping empty state.
