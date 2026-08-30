# Run Coach — design system (v3 overhaul)

Companion to `REQUIREMENTS.md`. This document is the contract for the UI layer: visual
language, tokens, component inventory and navigation. The implementation lives in
`app/globals.css` (tokens), `app/layout.tsx` (font wiring), `components/` (shared UI) and
the route files.

---

## 1. Visual direction: "Waymark"

Run Coach is opened twice: for 20 seconds in a hotel corridor at 21:40, and for 10 calm
minutes on a Sunday evening. Both moments happen at night, on a phone, by a tired person
who wants an answer, not an experience. The third design direction leaves the stadium
behind (v2's timing boards) and the training diary (v1's warm paper) and takes its world
from **night navigation**: OS maps, route cards, waymarker discs on fingerposts, a
head-torch on a dark hillside — the fell-running corner of the sport, and the owner's
Lake District weekends.

- **Dark-first: a forest at night.** The dark theme is the primary design target.
  Green-black ground (a pine wood after dark, not a neutral or blue black), torch-lit
  map-paper ink, moss-tinted card surfaces. Light mode is the same map unfolded in
  daylight: pale sage sheet, never warm cream.
- **The route line is the signature.** The Plan week renders as a route card: a dashed
  footpath line (the OS map footpath mark) threading round waymark nodes — one disc per
  day in the session's colour, today ringed in heather. The motif echoes small
  everywhere: every chip carries a waymark dot, shopping ticks and PIN dots are discs,
  the active tab gets a disc.
- **One accent: heather.** `--accent` is moorland heather violet — the flower against
  dark green — marking primary actions, the active tab's waymark, the today ring and
  links, nothing else. The `race` session colour deliberately shares the accent hue:
  race day is the point of the whole app. Warnings are gorse yellow; success is bracken
  green.
- **Structure encodes state.** Dashed lines appear only where they mean "path": the
  route line through the week, and the "why" aside under a session (a 2px dashed rule
  in the session's colour). Today is an accent ring on its node, not a tinted fill.
  Solid hairlines remain the quiet card grammar.
- **Colour = session type, always.** Each of the eight session types owns a fixed hue
  used identically in badges, route nodes and the volume chart. Badges always pair
  colour with a text label (colour-blind safe). No gradients (the dashed route line's
  repeating-gradient dashes are the one, non-colour exception), no shadows beyond the
  node rings, no illustration.

## 2. Colour system

All colours are CSS custom properties defined in `app/globals.css` under `:root` and a
`prefers-color-scheme: dark` override, mapped to Tailwind utilities via `@theme inline`.
The variable names are stable API — components never hard-code hex values.

### Core palette

| Token          | Light                    | Dark                     | Use |
|----------------|--------------------------|--------------------------|-----|
| `--bg`         | `#E8EBE1` map sheet      | `#0E1411` forest night   | page background |
| `--surface`    | `#FDFDF9` paper          | `#171E1A` pine           | cards |
| `--raised`     | `#DBE0D2`                | `#222B25`                | chips, secondary surfaces, keypad keys |
| `--ink`        | `#1B221D`                | `#EDF2EC` torch paper    | primary text |
| `--ink-2`      | `#4F5A52`                | `#A2AFA4`                | secondary text |
| `--ink-3`      | `#7F8A81`                | `#6C786F`                | tertiary/disabled text |
| `--line`       | `rgba(27,34,29,.13)`     | `rgba(237,242,236,.10)`  | hairline borders, route line |
| `--accent`     | `#6743C8`                | `#A88BF7` heather        | primary buttons, active tab, today ring, links |
| `--on-accent`  | `#FFFFFF`                | `#17102A`                | text on accent |
| `--accent-soft`| `rgba(103,67,200,.10)`   | `rgba(168,139,247,.14)`  | accent-tinted fills |
| `--ok`         | `#1C7F4B` bracken        | `#4CCE86`                | success, completed ticks |
| `--warn`       | `#8A650F` gorse          | `#E8B455`                | stale/warning banners |
| `--danger`     | `#BC3F33` rowan          | `#F87E70`                | errors, destructive actions |

### Session-type colours (fixed across the app)

Each has a strong tone (`--s-*`) for text/icons/nodes and a soft tone (`--s-*-soft`) for
fills. The accent moved from finish-tape pink to heather violet in this overhaul, so
`race` moved with it (the "race shares the accent hue" rule is deliberate and kept);
`cross` takes orchid pink in exchange — the eight hue families stay the same
colour-blind-distinguishable set as v2, with pink and violet swapped.

| Session     | Light strong | Dark strong | Abbrev (tables) |
|-------------|--------------|-------------|-----------------|
| `rest`      | `#68746C`    | `#93A096`   | Rest |
| `easy`      | `#1E8A4E`    | `#4FC97B`   | Easy |
| `tempo`     | `#8F6E0B`    | `#E7C64B`   | Tmp |
| `intervals` | `#C24237`    | `#F87E70`   | Int |
| `long`      | `#1D6FC2`    | `#5FB0F9`   | Long |
| `cross`     | `#B0338C`    | `#E88BD0`   | XT |
| `strength`  | `#0E8578`    | `#3FCFBD`   | Str |
| `race`      | `#6743C8`    | `#A88BF7`   | Race |

Badges are always colour + text label, never colour alone (colour-blind safe).

## 3. Typography

One signage superfamily plus a utility mono, self-hosted at build time via
`next/font/google` (wired in `app/layout.tsx`, exposed as `--font-body`,
`--font-display` and `--font-digits` in `app/globals.css`):

- **Barlow** (400/500/600/700) — body and UI copy. A low-contrast grotesque drawn from
  public signage lettering; warm and legible on a phone at night.
- **Barlow Condensed** (500/600/700) — the fingerpost face. Screen titles, hero session
  titles, big distances ("42 KM RUN" set like "KESWICK 4½"), overlines, chips, tab
  labels and buttons. Same superfamily as the body, so display and prose read as one
  system of signs.
- **IBM Plex Mono** (400/500/600) — route-card figures only: inline paces, km, dates in
  tables, chart labels, quantity columns. Demoted from v2's everywhere-display role to
  a quiet utility voice; the mono never sets a title.

Roles (utility classes in `app/globals.css`):

- **`.display`** — condensed 600, +0.005em: screen titles (26/32), hero session title
  (28/32), fingerpost date header (24, uppercase, +0.04em), big stat figures (32/21),
  expanded plan-row titles (19/23), PIN keys.
- **Headline 17/24 semibold (body face)** — card titles, recipe names.
- **Body 15/22 regular** — detail text, instructions.
- **Footnote 13/18 regular** — metadata, timestamps, banner copy.
- **`.overline`** — condensed 12/600, uppercase, +0.09em: section labels, column heads,
  stat captions.
- **`.tabular`** — mono with `tabular-nums`, −0.01em: inline figures (paces, km,
  minutes, dates in tables, chart labels, quantity columns).
- Buttons — condensed 16/600, +0.02em, sentence case (uppercase is reserved for
  overlines, chips, tab labels and the date header).

Headings carry −0.01em tracking globally.

**No paragraphs on main screens.** The four tab screens and the secondary
screens (Activity, Calendar, Check-in) never run a static explainer over two
or more lines. Static UI copy — footers, sub-lines, empty-state prose — is
deleted outright, replaced with a visual (chip, disc, stat) where one carries
the same meaning, or condensed to one short line (≤ 8 words where possible).
Generated coaching content (week_summary, session detail/why, the revision
note, recipe method, injury read-back) is never deleted, but is contained:
tucked behind an existing disclosure (an expand-on-tap row, the Nutrition
screen's `<details>` "Recipe" pattern) or truncated to one or two lines with
the full text one tap away. Banners stay one line, always actionable.

## 4. Spacing, radius, elevation

- 4 px base grid. Screen padding 16 px; card padding 16 px; section gap 24 px; card gap 12 px.
- Radius: cards 14 px; sheets 16 px; inputs and buttons 10 px; chips fully round
  (waymark tags); keypad keys, PIN dots, plan nodes and shopping ticks are discs.
  v2's rectangular timing tags are retired.
- Elevation: none. Separation is surface tone + 1 px `--line` hairlines. The only other
  strokes are semantic: the dashed route line (`.route-line`), the dashed "why"
  footpath aside (`.path-aside`, 2 px, session colour), and the today node's 2 px
  accent ring.
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
| Tab bar | `components/tab-bar.tsx` | V2: 4 tabs (Dashboard · Plan · Nutrition · Settings), blur surface, active = accent + waymark disc above the icon, condensed uppercase labels; tapping active tab scrolls to top; hidden on `/pin`. |
| Card | utility classes (`.card`) | Surface, radius 14, hairline border. |
| Session badge | `components/session.tsx` | Waymark tag: soft fill + strong text + leading colour disc, condensed uppercase. Fixed colour per type. |
| Meal-type badge | `components/session.tsx` | v1 legacy rendering only (Home / Eating out / Quick) — the v2 meal model has no meal types. |
| Context chip | `.chip` utility | Header chips: "Travel day", "Race week", "6 weeks to …". Every chip carries the waymark dot via `.chip::before`. |
| Banner | `components/banner.tsx` | Variants: warn (stale/disconnected), error, info, offline; `quiet` prop (V2 Dashboard) drops the fill for tinted text + hairline so banners sit below the hero visually. |
| Offline banner | `components/offline-banner.tsx` | Client; listens to online/offline events. |
| Dinner card (Dashboard) | rendered in `app/page.tsx` | V2: shown ONLY when today is an away day with a planned prep-ahead meal; links to Nutrition. Home days show no meal card. |
| Volume lookback card | rendered in `app/page.tsx` | V2: 7-day running km (run-only, U1) in fingerpost lettering + planned-sessions-done summary; opens `/activities`. |
| Quick actions grid | rendered in `app/page.tsx` | V2: 2x2 — Log a session (sheet), Add a goal race (`/settings#race`), Add a check-in (`/checkin`), Update training plan (`/plan?edit=1`). |
| Week summary strip | `.stat-strip` utility, rendered in `app/plan/page.tsx` | A one-line km/sessions readout (summed from `training_plan_json`, never parsed from `week_summary`) standing in for the coach's paragraph; sits in a `<details>`/`<summary>` disclosure ("Summary" / "Close") — the same pattern as the Nutrition recipe cards — that reveals `week_summary` and the revision-note quote on tap. Falls back to a short "Old plan format" line when the plan predates structured days. |
| Plan week toggle | `app/plan/week-toggle.tsx` | V3: a segmented control — "This week" / "Next week", 44 px targets, each segment carries a waymark dot (accent when active, like the tab bar's active marker). Opens on This week; `?edit=1` opens on Next week. Client-side only — both weeks are fetched server-side in `app/plan/page.tsx` and handed down as already-rendered content; the inactive panel is `hidden`, not unmounted, so Next week's edit state survives a glance at This week. |
| This week review | `app/plan/this-week-review.tsx` | V3: the route card as a REVIEW surface, read-only, chronological Monday→Sunday (no reordering). Past days show the planned session, a Done/Missed chip (colour + text, from the unchanged `sessionDone`/`completedCategories` matching in `components/data.ts`) and a "Logged: …" line built from the merged Strava/manual activity stream (type, distance, duration) — shown even when it disagrees with the plan, so a mismatch is visible rather than hidden. Rest days show no Done/Missed chip (nothing to complete) but still surface a Logged line if cross-training happened. Today is ringed in accent, no completion chip (the day isn't over). Future days render as plain upcoming entries. No edit affordances anywhere in this view. |
| Next week plan | `app/plan/next-week-plan.tsx` | V3: the route card as the PLANNING surface — the only place batch-edit lives. Same node \| date \| detail \| volume rows as before, tap to expand the full session card. Edit mode (ported from the retired single-week `plan-table.tsx`, behaviour unchanged): per-row session-type quick-pick + free-text (`addPendingChange`), whole-week instruction, inline check-in note (`savePendingCheckin`), pending list with per-item Remove and Clear all, ONE "Apply changes — regenerate" → `POST /api/plan/generate` `{ apply_pending: true, week_start_date: <next Monday> }` (~30 s state, 429/500 surfaced). Deep-linked from the Dashboard via `?edit=1` (opens on the Next week tab with edit mode already on). Empty state (no plan yet): "generates automatically on Sunday evening… you can also generate it now" + `GeneratePlanButton`. |
| Route node / route line | `app/plan/route-node.tsx` | Shared furniture behind both list components above: the dashed `.route-line` segment and the session-coloured `WaymarkNode` disc (ringed in accent for today) — kept in one file so the two lists stay visually one system. |
| Away meal card | `app/food/page.tsx` | V2: `<details>` row — date + recipe + prep time, expanding to ingredients (item \| quantity) and method. |
| Shopping list | `app/food/shopping-list.tsx` | Client; grouped by category with Item \| Volume columns (`quantity_note` right-aligned); localStorage ticks keyed by week + generated_at; ticks are waymark discs; checked sink + strike; "Reset ticks". |
| Generate/regenerate | `components/generate-plan.tsx` | Confirm sheet when replacing; in-flight spinner label "Planning your week… (about 30 seconds)"; error + retry. Optional `weekStartDate`/`weekLabel` props (added for the Plan screen's two weeks) put an explicit `week_start_date` on the `POST` body and retarget the copy ("Generate next week's plan" / "Replace next week's plan?"); omitted (Dashboard, and everywhere pre-V3), the request is byte-identical to before — no body at all. |
| Sync button(s) | `app/settings/connections.tsx`, secondary-screen sync buttons | Combined sync = both providers, independent per-provider results. |
| Tag input | `app/settings/food-form.tsx` | Type + add, tap to remove; writes hidden comma-joined field (keeps server-action field names). |
| Stepper | `app/settings/food-form.tsx` | Household size 1–6. |
| PIN keypad | `app/pin/pin-pad.tsx` | 4 waymark-disc dots, round keypad posts 0–9 + delete, auto-submit on 4th digit, shake on 401, countdown lockout on 429. |
| Check-in forms | `app/checkin/checkin-forms.tsx` | Two textareas, one Save each: weekly note (keyed to the week containing today) and persistent injuries with "Clear — all healed". Fix round 1, U4. |
| Injury history list | `app/checkin/injury-history.tsx` | Round 2, U5. Visually secondary list under current injuries: description + period rows, inline add/edit forms, in-place delete confirm. |
| Log-session sheet | `app/activities/log-session.tsx` | Round 2, U6. Bottom sheet (radius 16): date, session-type quick-pick chips + free-text "Other", duration, distance (run-ish types only), note. Entry points: Dashboard quick action ("tile" appearance), Activity header (and empty state), Dashboard hero when today's session is unticked (pre-selects the type). `ManualActivityActions` adds Edit/Delete to manually logged rows only; manual rows carry a "Logged manually" label and never show pace. |
| Skeletons | `loading.tsx` per route + `.skeleton` utility | Reserve final layout space; visible < 500 ms. |
| Empty states | per screen | Icon-free, one sentence + one action, per REQUIREMENTS §3 / REDESIGN-V2. |

Retired in V3 (visual only — behaviour unchanged): the timing-board mono display voice,
rectangular timing tags, the hero start-line rule, the today lane bar and the active-tab
lane indicator (replaced by the route line, waymark tags/dots, the footpath aside and
the today node ring). Retired in V2 and still gone: the 7-day week strip, the 3-tile
snapshot row, the Today check-in row, the Food Meals ⇄ Shopping segmented control, and
the round-2 Suggest-changes card.

## 6. Navigation map (V2 — docs/REDESIGN-V2.md)

Bottom tab bar (always visible except on `/pin`):

1. **Dashboard** — `/` (PWA start URL)
2. **Plan** — `/plan` (V3: a two-week toggle — This week review, Next week planning + edit
   mode; `?edit=1` opens on the Next week tab with edit mode already on)
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
  `quantity_note` as the "Volume" column. Generation guarantees the
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
- V3 (two-week Plan screen): the body also accepts an optional
  `week_start_date` (`YYYY-MM-DD`, clamped to its Monday via `mondayOf`).
  When present it is used both to load/apply that week's pending changes
  (instead of the boundary week) and as `targetWeekStart` into
  `generateWeeklyPlan` (an option `lib/weeklyPlan.ts` already exposed for the
  voice check-in). Omitted, behaviour is byte-identical to before — the
  boundary week, exactly as the Dashboard and cron paths still call it. The
  Plan screen sends next week's Monday on every Next week generate/apply
  call (and this week's Monday on This week's regenerate action, since after
  Sunday 17:00 the boundary week and "this week" diverge).

## 9. States checklist (stress-tester map)

Every tab screen implements: **loading** (route `loading.tsx` skeletons), **empty** (specified
copy + action), **error** (route `error.tsx` with retry), **offline** (global banner + cached
render via service worker). Today additionally: no-plan card, stale-sync banner, disconnected
banners, Sunday plan-ready banner. Food additionally: all-travel shopping empty state.
