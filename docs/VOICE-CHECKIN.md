# Voice check-in (§3.12)

The Sunday meeting: one voice conversation replaces the typed weekly feedback,
injury update, schedule notes and cooking plan. ElevenLabs runs the voice
agent; Claude turns the answers into plan changes; the existing revision
engine updates the training and meal screens.

## Flow

1. **Start** — the Check-in screen's "Start Sunday check-in" button calls
   `POST /api/checkin/voice/start`. The server ensures the ElevenLabs agent
   exists (`lib/elevenlabs.ts` creates the agent and its two client tools on
   first use, cached in the `voice_agent` row), builds the briefing
   (`lib/voiceCheckin.ts`: last week's recorded training, current injuries,
   the stored plan, next week's calendar) and returns a signed WebSocket URL.
   The meeting is always forward-looking: it reviews the week containing
   today and targets the week AFTER it — deliberately ignoring the app's
   Sunday 17:00 boundary rule, so a Sunday-afternoon check-in still briefs
   and plans the week ahead (the apply step passes `targetWeekStart` through
   to `generateWeeklyPlan` for the same reason)
   plus the briefing as dynamic variables. The API key never leaves the
   server.
2. **The meeting** — the agent runs three parts in one conversation: how the
   week's training felt and any niggles; what's on next week's schedule beyond
   the calendar; which days need no cooking.
3. **Analyse** — the agent calls the `submit_checkin` client tool; the browser
   relays it to `POST /api/checkin/voice/analyse`. One Claude call
   (`claude-opus-5`, structured output) produces a proposal: feedback note,
   updated injuries text, minimal training changes, no-cook dates, and a
   spoken summary. Stored in `voice_checkins`; the summary is read back for
   confirmation. "Actually, can we…" loops through `submit_checkin` again.
4. **Apply** — on a clear yes the agent calls `confirm_checkin` →
   `POST /api/checkin/voice/apply`: writes `weekly_feedback` and
   `runner_context` through the same paths as the typed forms, writes the
   proposal's calendar additions into `calendar_events` (external_id
   `checkin:…`, replaced wholesale per week so re-runs never leave stale
   entries; the Microsoft sync's prune skips them, and they show on the
   Calendar screen with a Check-in chip), then (when the proposal carries
   changes) runs ONE `generateWeeklyPlan` revision — calendar first, so
   travel/away logic sees the new events. A revision note against a week with
   no stored plan folds into the fresh generation rather than being dropped.
   Plan, Nutrition and Calendar screens revalidate.

Nothing changes without the spoken confirmation; an abandoned call leaves the
proposal row at `proposed` and touches no data.

A confirmed check-in is a standing agreement for its week: every later
generation of that week — the Sunday cron's fresh plan, the manual Generate
button, pending-batch revisions — folds the latest applied proposal back in
(`loadAppliedCheckin` in `lib/weeklyPlan.ts`), so cron order doesn't matter
and a no-cook day stays meal-free however many times the week regenerates.

## Setup

- `ELEVENLABS_API_KEY` in Vercel env vars (required).
- `ELEVENLABS_AGENT_ID` (optional) to pin a dashboard-managed agent instead of
  the app-managed one.
- Run the "Voice check-in migration" block at the bottom of
  `supabase/schema.sql` in the Supabase SQL editor (`voice_agent` +
  `voice_checkins` tables).

The typed forms on the Check-in screen remain as the fallback and write to the
same tables.

## Done state and revise mode

An applied `voice_checkins` row for the target week is the done signal: the
Dashboard's check-in tile shows "Check-in done" with the date (green tick),
and the Check-in screen's button becomes "Revise check-in". A revise meeting
skips the three parts — the coach reads back the recorded feedback and next
week's plan, asks what to change, and submits the merged answers. Revise
proposals leave the recorded feedback note untouched unless revisited, and
append calendar events rather than replacing the week's earlier ones. The
meeting mode travels inside `answers_json.mode`.

## Ask Coach (Dashboard)

The Dashboard's Ask Coach tile opens a free-form voice session on the same
stack (`useVoiceSession("coach")` → `POST start {session:"coach"}`). No
script: the agent answers questions about training, nutrition and the race
build from its briefing (which includes the race goal + phase), and when the
runner asks for changes — upcoming sessions, feelings, niggles, meals — it
runs the same submit/confirm tool flow. Coach sessions target the BOUNDARY
week (the week in progress; flips Sunday 17:00), the analysis only touches
days from today onward, and calendar additions append rather than replace.
Questions-only sessions touch no data.
