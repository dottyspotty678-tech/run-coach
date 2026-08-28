# Redesign v2 — user-sketched UI (28 Aug 2026)

The user hand-sketched a leaner 4-tab UI and new behavioural logic, then
answered clarifying questions. This document is the contract for v2 and
overrides REQUIREMENTS.md where they conflict. The sketch: four screens —
Dashboard, Training plan, Nutrition plan, Settings.

## Global: 4 tabs
Tabs become: **Dashboard · Plan · Nutrition · Settings**. The Activity tab
is removed; activity history (list + 8-week chart) moves to a SECONDARY
screen opened by tapping the Dashboard volume card (same pattern as
Calendar). Nothing from the current Activity screen is deleted — it just
relocates. "Log a session" stays reachable (quick action + on the history
screen).

## Screen 1 — Dashboard (replaces Today)
Top to bottom, per the sketch:
1. **Today's session hero** (keep current behaviour/format, e.g.
   "15km — Zone 2").
2. **Today's dinner card** — ONLY if today is an away day with a planned
   meal (see meal model below); otherwise omit the card entirely (home
   days have no meal planning).
3. **Total training volume, 7-day lookback** — compact card: running km
   (run-only, per U1) + sessions-done tick summary. Tapping it opens the
   relocated Activity history screen.
4. **Quick access buttons** (2x2 grid): "Log a session" (existing sheet),
   "Add a goal race" (deep-link to Settings race section), "Add a
   check-in" (to /checkin), "Update training plan" (to Plan tab's edit
   mode).
Existing banners (sync issues, Sunday states) stay, but visually quieter
than the hero.

## Screen 2 — Training plan (table + batch edit + apply)
- Layout becomes a compact TABLE: rows = Today, Tomorrow, then remaining
  plan days (the sketch's N+1..N+5); columns = Date | Volume | Detail
  (volume = duration/distance e.g. "15km" or "Gym"; detail = short text
  e.g. "Zone 2", "Lower body focus"). Tapping a row expands to the full
  session card (title/detail/why — keep the existing content).
- **Editing (batch + Apply, per user decision):** an Edit mode where the
  user can (a) request changes per day (structured: change session type /
  free-text instruction per row) and (b) jot a check-in note inline.
  Changes accumulate as PENDING CHANGES (persisted, so they survive
  navigation) and NOTHING regenerates until one **"Apply changes —
  regenerate"** action fires ONE Claude call containing all pending
  changes + any new check-in, via the existing revise flow semantics
  (keep-stable rules, rate limits, generate-then-swap). Pending changes
  clear on successful apply. The existing "Suggest changes" free-text card
  merges INTO this edit mode (one editing concept, not two).

## Screen 3 — Nutrition plan (away-day meal prep model)
**Meal model inverted from v1 (explicit user decision, "literal" option):**
- Meals are generated ONLY for AWAY days. Home days get NO meal planning.
- Away-day meals are REAL RECIPES (this is a meal-prep model: the user
  preps/cooks ahead at home and takes food when travelling). Tap a meal →
  full recipe (ingredients + method).
- **Shopping list** covers exactly the away-day meals' ingredients, with a
  Volume/quantity column (sketch: Item | Volume). Keep quantities
  qualitative-friendly ("2 fillets", "1 bag") — still no calorie counts.
- Screen layout: "Next away days" list (date + meal name, tap for recipe),
  then the shopping list. Empty state when no away days in the window:
  say so plainly ("No away days coming up — nothing to prep").
- The old home-recipe/travel-eating-out guidance model is RETIRED. Remove
  meal_type-driven eating-out copy from generation (session travel
  awareness for TRAINING stays unchanged).

## Away/home status engine (new, replaces the travel heuristic for MEALS)
Status per calendar day, derived from synced calendar events:
- **Away** when a hotel booking pattern is detected: an event that looks
  like a hotel check-in ("check-in", hotel/booking-confirmation titles)
  sets status away from that day UNTIL THE DAY BEFORE the matching
  check-out event (or the day before the event's own end for multi-day
  bookings).
- **Away** also when any event mentions a location that is NOT Manchester
  or London (both are HOME bases — explicit user decision): away from
  that day until the day before the booking/event ends.
- Otherwise **home**. Events with no location and no hotel pattern do not
  change status.
- The existing is_travel flag continues to inform TRAINING (travel-day
  sessions); the away/home engine governs MEALS. Implementation may unify
  them where sensible, but the meal rule follows this section exactly.

## Screen 4 — Settings
Unchanged ("keep this the same as before").

## Carry-over fix
f-1 (final test report): week_summary sometimes states a running total
that contradicts the sum of the day sessions — add a prompt rule that any
stated total must equal what the seven training_days actually sum to.

## Unchanged foundations
PIN gate, connections, sync engines, check-in/injuries/manual sessions,
evidence grounding, rate limits, generate-then-swap, UK English, no
calories, PWA shell. REQUIREMENTS.md sections on the Food tab and Today
screen are superseded by this document.
