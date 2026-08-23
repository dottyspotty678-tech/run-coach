# Run Coach — stress test report, round 1

Date: 23 Aug 2026 (Sunday, ~20:40 Europe/London / 19:40 UTC)
Target: https://run-coach-fawn.vercel.app (live production, freshly deployed)
Tester method: `curl` with a signed PIN session cookie. Source cross-referenced read-only at
`C:\Dev\Run-coach`. Held against `docs/REQUIREMENTS.md` (v1) and `docs/DESIGN.md`.

Session established once via:

```
curl -s -c rc.txt -X POST https://run-coach-fawn.vercel.app/api/pin/verify \
  -H "Content-Type: application/json" -d '{"pin":"2522"}'
```

`-b rc.txt` passed on all authenticated requests thereafter.

---

## Headline

The **PIN gate, sync, PWA plumbing, method handling and input validation are all solid** — the
security-critical surface passes. But the **core of the entire v1 redesign — structured plan
generation — fails in production**: `POST /api/plan/generate` returns **500 twice in a row**
(~50 s each). No new-format plan has ever been stored, so every data screen is still rendering
the **pre-redesign old-format fallback** ("This plan predates the current format — regenerate…").
The redesign's marquee features (§3.2 hero card, §3.3 day cards, §3.4 meal types, §3.5 shopping
list) cannot be observed live because generation never succeeds. This is the one Critical.

Severity counts: **Critical 1 · Major 2 · Minor 4 · Cosmetic 1.**

---

## Findings

### C-1 (Critical) — Plan generation returns 500 in production; core redesign unobservable

- Area: §3.7 generation, blocks §3.2/§3.3/§3.4/§3.5.
- Repro:
  ```
  curl -s -X POST -b rc.txt https://run-coach-fawn.vercel.app/api/plan/generate -w " [%{http_code} %{time_total}s]"
  ```
- Expected (§3.7): 200; a validated structured plan stored (generate-then-swap); the new
  format then renders on Plan/Food/Today.
- Actual: `{"error":"Couldn't generate the plan — try again in a minute."}` **500**, after
  **50.2 s** — and again **500 after 50.4 s** on a second attempt two minutes later. Persistent,
  not transient. The friendly copy matches §3.7 (error handling is correct), but generation
  itself is broken.
- Diagnosis (from source, no server logs available): the consistent ~50 s ≈ two ~25 s cycles,
  matching the two-attempt retry loop in `lib/weeklyPlan.ts › generateWeeklyPlan`. Most likely
  one of: (a) the model id `"claude-sonnet-5"` in `callClaude` is rejected or the tool call
  never validates; (b) `validatePlan` fails twice (the model output does not satisfy the strict
  date/travel/enum guards) and it throws "failed validation"; (c) the `weekly_plans` upsert
  fails because a migration column (`training_plan_json` / `week_summary` / `shopping_list_json`)
  is missing despite the migration reportedly having run. The route already `console.error`s the
  underlying error — **check the Vercel function logs for `/api/plan/generate` to disambiguate**.
- Knock-on: the Sunday 18:00 cron (`app/api/cron/generate-plan/route.ts`) calls the same
  `generateWeeklyPlan`, so the automated weekly plan is almost certainly failing too — which
  explains why the live plan is still old-format.
- Likely files: `lib/weeklyPlan.ts` (model id, validation, upsert), `supabase/schema.sql`
  (column presence).

### M-1 (Major) — All data screens serve the pre-redesign old-format plan

- Area: §3.2, §3.3, §3.4, §3.5.
- Repro: `curl -s -b rc.txt https://run-coach-fawn.vercel.app/` (and `/plan`, `/food`).
- Expected: Today shows a hero session card + week strip with session abbreviations; Plan shows
  7 day cards with session badges + week summary; Food shows meal-type badges + categorised
  shopping list.
- Actual: Today renders a **narrative blob** as "This week's plan" and the week strip shows
  `M – T – W – T – F – S – S` with **no session abbreviations**. Plan shows
  `"…predates the current format — regenerate to get a week summary and day-by-day sessions"`.
  Food renders legacy meals behind "Method" disclosures. This is the graceful fallback in
  `lib/planTypes.ts` working as designed — but it is the *only* state a user can see until C-1
  is fixed. Downstream symptom of C-1; will clear once a structured plan stores successfully.
- Likely files: same as C-1.

### M-2 (Major) — UK-English content rule violated in live meal copy

- Area: §4 "UK English everywhere".
- Repro: `curl -s -b rc.txt .../ | grep -i chili` ; `curl -s -b rc.txt .../food | grep -i yogurt`
- Expected (§4): UK spellings throughout generated content.
- Actual: live content contains **"Chili"/"chili"** (Today meal: "Leftover Chili with Rice &
  Greens", "Reheat Saturday's chili…") and **"yogurt"** (Food: "oats · milk or yogurt · banana").
  UK forms are "chilli" and "yoghurt". Note: this copy is from the pre-redesign plan; the
  *current* prompt in `lib/weeklyPlan.ts › buildPrompt` does demand UK English, so a successful
  regeneration *may* fix it — but that cannot be verified while C-1 blocks generation. Flagging
  so it is re-checked on the first good generation, and so the developer confirms the prompt's
  UK-English instruction actually holds for words like chilli/yoghurt.
- Likely files: `lib/weeklyPlan.ts` (prompt) — plus stale data.

### m-1 (Minor) — Raw ISO date shown to the user in the training context

- Area: §4 "DD MMM date style".
- Repro: `curl -s -b rc.txt .../` → "…your most recent run on **2026-08-15**".
- Expected: DD MMM ("15 Aug"). Actual: bare `YYYY-MM-DD`. This string is assembled in
  `lib/weeklyPlan.ts › buildContext` (`lastActivityDate`) and rendered verbatim in the
  old-format summary. Confirm the new-format `week_summary` avoids raw ISO dates too.
- Likely files: `lib/weeklyPlan.ts`.

### m-2 (Minor) — Sunday "next week's plan is ready" banner may double-message the shown week

- Area: §3.2.6 vs §3.3 week-boundary rule.
- Repro: `curl -s -b rc.txt .../` (run on Sunday after 17:00) → Today shows both a
  `"Next week's plan is ready — Review it"` banner **and** a section headed "This week's plan".
- Expected: from Sunday 17:00 the screens already flip to the upcoming week (§3.3), so a
  separate "next week is ready" banner risks pointing at the same week the user is already
  looking at. Worth confirming the banner's "next week" reference and the boundary flip are not
  describing the same Monday. Hard to fully confirm via curl (depends on which `week_start_date`
  rows exist); flagged for the developer to verify against `app/page.tsx` banner logic and
  `components/dates.ts › boundaryWeekStart`.
- Likely files: `app/page.tsx`, `components/dates.ts`.

### m-3 (Minor) — Mixed-case API path returns an HTML redirect instead of JSON 401

- Area: §3.1 coverage (defence-in-depth; not a bypass).
- Repro: `curl -s -X POST .../Api/plan/generate -w "%{http_code}"` → **307** to `/pin`
  (vs `/api/plan/generate` → 401 JSON).
- Expected: the request is still gated (good — no bypass). But because `middleware.ts`
  matches the `/api/` prefix case-sensitively, a mis-cased API path is treated as a *page* and
  gets an HTML redirect rather than the JSON 401 an API client expects. Cosmetic-to-minor:
  Next routes are case-sensitive so the path would 404 after auth anyway. Consider normalising
  case in `isExempt`/the API check.
- Likely file: `middleware.ts`.

### m-4 (Minor) — Spec/route naming: tab is "Activity" but route is `/activities`

- Area: §3.0 / DESIGN §6.
- Repro: `/activity` → **404**; `/activities` → **200**.
- Expected: not a bug — DESIGN §6 defines the route as `/activities` and it works. Noted
  because REQUIREMENTS §3.0 and the test brief both say "Activity" (singular); anyone deep-linking
  `/activity` will 404. Purely a naming-consistency note.
- Likely file: `app/activities/`.

### cos-1 (Cosmetic) — "Error" label present in Settings connections markup

- Area: §3.8 status surfacing.
- Repro: `grep -i error pg-set.html` → a couple of "Error" labels in the connections markup,
  alongside the correct `"Last synced 1 min ago"` after a successful sync.
- Expected/actual: after a clean sync both providers correctly show "Last synced 1 min ago" and
  no error banner is active. The "Error" strings appear to be the (inactive) last-error slot
  template rather than a live error. No user-visible problem observed; noting only so the
  designer confirms the error slot stays hidden when `last_error` is null.
- Likely file: `app/settings/connections.tsx`.

---

## What PASSED (verified working)

**PIN gate security (§3.1) — the most important area, fully passes:**

- No cookie: `/`, `/plan`, `/food`, `/activities`, `/calendar`, `/settings` all **307 → /pin**
  (with `?next=` preserved). Every API route **401 JSON** without a cookie:
  `/api/strava/sync`, `/api/microsoft/sync`, `/api/plan/generate` (POST),
  `/api/strava/connect`, `/api/microsoft/connect` (GET).
- Exempt paths reachable pre-auth: `/pin` (200 HTML), `/manifest.json` (200 JSON),
  `/sw.js` (200 JS), `/icon-192.png`, `/icon-512.png` (200 PNG).
- `/api/cron/sync` and `/api/cron/generate-plan` without the `Authorization: Bearer` header:
  **401** (GET) — routes are GET-only, POST returns 405.
- Cookie flags correct: `Set-Cookie: rc_auth=…; Path=/; Max-Age=15552000; Secure; HttpOnly;
  SameSite=lax` (HMAC value, 180 days) — matches §3.1.
- Tampered / truncated / garbage cookie values (`deadbeef`, one-char, valid-minus-last-char):
  page **307 → /pin**, API **401**. Not forgeable, length pre-check does not leak.
- Bypass tricks all fail safe — every one ends at 401 or the PIN screen:
  `/PIN` (case) → 307; `/Api/plan/generate` (case) → 307; `/api/plan/generate/` (trailing) →
  308 → 401; `//api/plan/generate` (double-slash) → 308 → 401; `/api/plan/generate/..` →
  normalised to `/api/plan` → 401; `/plan?foo=1` (query) → 307 → /pin.
- Lockout works: 5 consecutive wrong/malformed PINs from a session → **429
  `{"retryAfterSeconds":30}`** (REQUIREMENTS says 5; brief said "six" — the 5-failure brake per
  §3.1 fired correctly). Correct PIN before that → 200 + cookie.

**Pages render (§3.2–3.9):** with a valid cookie all of `/`, `/plan`, `/food`, `/activities`,
`/calendar`, `/settings`, `/pin` return **200** with no "Application error", exception strings,
or empty shells. Settings shows all three sections (Race goal + Clear race + Target time; Food
prefs Lose/Maintain + dietary + disliked + household; Connections Strava/Microsoft with
Connect/Reconnect/Disconnect, Sync now, and "Last synced … ago"), plus the "PIN protected"
footer. Activities shows the 8-week weekly chart labels, 7-day/28-day framing, distances and
pace as `min/km` (e.g. "4:59 /km"), last-30-days list. Calendar shows next-14-days events with
**24-hour times** (e.g. "18:00"), **DD MMM dates** ("24 Aug", "2 Sep"), Travel badges, and the
heuristic footer ("marked as travel…", "spans multiple days").

**Sync (§3.8):** `POST /api/strava/sync` → `{"synced":10}` (200, 1.3 s);
`POST /api/microsoft/sync` → `{"synced":6}` (200, 1.4 s). Settings then shows
"Last synced 1 min ago" per provider, no error. Both providers connected.

**Rate limiting (§3.7):** immediate second `POST /api/plan/generate` →
**429 `{"error":"Easy tiger — you can regenerate again in a moment."}`** (2-minute brake).

**Method / input handling (§ edge cases):** GET and HEAD on POST-only routes
(`/api/plan/generate`, `/api/strava/sync`, `/api/pin/verify`) → **405**, no 500.
`/api/pin/verify` with malformed JSON / `{}` / non-string pin / 3-digit pin → **401
"Wrong PIN"**, handled gracefully.

**Content bans (§4):** **no emoji** anywhere (checked all six screens); **no calorie / kJ /
macro / points numbers** — "protein" appears only qualitatively ("grilled protein
(chicken/fish)"), which is allowed.

**PWA plumbing (§5.2):** `manifest.json` is valid JSON with `name`, `short_name`,
`start_url:"/"`, `display:"standalone"`, `theme_color:"#101214"`, and 192/512 icons.
`sw.js` is valid JS, **network-first with cache fallback**, and correctly **never caches
`/api/*` or `/pin`** (`isCacheable` excludes both), only same-origin GETs.

**Timezone (§5.5):** Today header renders "Sun 23 Aug" (correct Europe/London date).

**Travel guidance (§3.4):** even in the old-format meals, travel days surface eating-out
guidance ("protein-forward dinner" / "pub-style protein + veg") rather than home recipes, and
the calendar shows travel events for the coming week (24 Aug–2 Sep) — so once C-1 is fixed this
is directly re-checkable.

---

## v1 Must-have verdict

| Requirement | Verdict | Note |
|---|---|---|
| §3.0 Navigation (5 tabs, routes) | PASS | routes resolve; visual tab bar not curl-testable |
| §3.1 PIN gate | **PASS** | coverage, cookie flags, lockout, bypass-resistance all verified |
| §3.2 Today (hero card) | **FAIL (blocked by C-1)** | only old-format narrative fallback renders |
| §3.3 Weekly plan — training (structured) | **FAIL (blocked by C-1)** | no structured plan ever stored |
| §3.4 Weekly plan — meals (types) | **FAIL (blocked by C-1)** | legacy meals only; + M-2 UK-English |
| §3.5 Shopping list | **FAIL (blocked by C-1)** | categorised list depends on generation |
| §3.7 Generation & regeneration | **FAIL** | 500 on generate; rate-limit + error copy PASS |
| §3.8 Sync | PASS | both providers 200, status surfaced |
| §3.9 Settings | PASS | all three sections render |
| §4 Content rules | PARTIAL | no emoji/macros; UK-English breached (Chili/yogurt) + raw ISO date |
| §5.2 PWA / offline | PASS (server side) | manifest + SW correct; install/offline UX not curl-testable |
| §5.5 Time / Europe/London | PASS (observable parts) | today + 24h times + DD MMM correct |

Everything tagged "blocked by C-1" is expected to pass once generation succeeds and a
structured plan is stored — they should be re-tested immediately after the C-1 fix.

---

## Could NOT be tested from this environment (human/visual check needed)

- All visual rendering: dark/light mode, the burnt-orange accent, session-type colour coding,
  hierarchy/scale of the Today hero card, hairline borders, no-gradient rule.
- Touch interactions: tab bar taps, tap-active-tab-scrolls-to-top, week-strip/meal-card
  deep-links (`#d{date}`), Method disclosures, segmented Meals⇄Shopping control, steppers,
  tag inputs, confirm sheets.
- PIN keypad UX: on-screen keypad, dot placeholders, auto-submit on 4th digit, shake on wrong
  PIN, on-screen 30 s countdown during lockout.
- Loading skeletons (`loading.tsx`, visible < 500 ms) and no-layout-shift behaviour.
- Offline behaviour end-to-end: the offline banner, cached-render on a dead connection,
  pull-to-refresh combined sync on Today.
- Shopping-list localStorage ticks (persist per week, sink+strike, "Reset ticks").
- Real iPhone PWA install: Add-to-Home-Screen, standalone display, themed status bar, safe-area
  insets (notch / home indicator), tab bar above the home indicator.
- Performance targets (§5.1): Today interactive < 2 s on 4G on a real device.
- The new structured plan/meal/shopping content itself (blocked by C-1) — re-run the content
  scans (UK English, no macros, travel-day guidance, 24-hour/London formatting) on the first
  successful generation.

---

Two plan generations were spent (both 500) — the brief's budget is now exhausted; do not
regenerate again until C-1 is diagnosed from server logs. No destructive actions were taken; no
code was modified.
