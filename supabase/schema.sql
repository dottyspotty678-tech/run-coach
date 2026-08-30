-- Run this once in the Supabase dashboard's SQL Editor after creating the project.
-- Single-user app: RLS policies just require an authenticated session, no per-row ownership checks.

create table if not exists oauth_tokens (
  provider text primary key check (provider in ('strava', 'microsoft')),
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists strava_activities (
  external_id bigint primary key,
  type text not null,
  distance_m real not null,
  duration_s integer not null,
  start_date timestamptz not null,
  average_pace real,
  raw_json jsonb not null,
  synced_at timestamptz not null default now()
);

create table if not exists calendar_events (
  external_id text primary key,
  title text,
  start_time timestamptz not null,
  end_time timestamptz not null,
  is_all_day boolean not null default false,
  is_travel boolean not null default false,
  synced_at timestamptz not null default now()
);

create table if not exists settings (
  id boolean primary key default true check (id = true), -- singleton row
  weight_goal text not null default 'maintain' check (weight_goal in ('lose', 'maintain')),
  dietary_restrictions text[] not null default '{}',
  disliked_ingredients text[] not null default '{}',
  household_size integer not null default 1
);

create table if not exists race_goal (
  id boolean primary key default true check (id = true), -- singleton row
  race_name text not null,
  distance_km real not null,
  race_date date not null,
  target_time interval
);

create table if not exists weekly_plans (
  week_start_date date primary key,
  training_plan_text text not null,
  meal_plan_json jsonb not null,
  input_snapshot_json jsonb not null,
  generated_at timestamptz not null default now()
);

alter table oauth_tokens enable row level security;
alter table strava_activities enable row level security;
alter table calendar_events enable row level security;
alter table settings enable row level security;
alter table race_goal enable row level security;
alter table weekly_plans enable row level security;

create policy "authenticated full access" on oauth_tokens for all using (auth.role() = 'authenticated');
create policy "authenticated full access" on strava_activities for all using (auth.role() = 'authenticated');
create policy "authenticated full access" on calendar_events for all using (auth.role() = 'authenticated');
create policy "authenticated full access" on settings for all using (auth.role() = 'authenticated');
create policy "authenticated full access" on race_goal for all using (auth.role() = 'authenticated');
create policy "authenticated full access" on weekly_plans for all using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- Redesign migration (run this block in the Supabase SQL Editor)
-- Idempotent: safe to run more than once.
-- ---------------------------------------------------------------------------

-- Structured plan storage (REQUIREMENTS §6): per-day training entries, the
-- week summary and the shopping list, alongside the legacy text/meal columns.
alter table weekly_plans add column if not exists training_plan_json jsonb;
alter table weekly_plans add column if not exists week_summary text;
alter table weekly_plans add column if not exists shopping_list_json jsonb;

-- Per-provider sync bookkeeping (REQUIREMENTS §3.8) — read by the UI's
-- getSyncStatus and written on every sync run.
create table if not exists sync_status (
  provider text primary key check (provider in ('strava', 'microsoft')),
  last_synced_at timestamptz,
  last_error text
);

-- Manual plan-generation log (REQUIREMENTS §3.7 rate limits): minimum 2
-- minutes between manual generations, maximum 8 per London calendar day.
create table if not exists generation_log (
  id bigint generated always as identity primary key,
  source text not null default 'manual' check (source in ('manual', 'cron')),
  requested_at timestamptz not null default now()
);

alter table sync_status enable row level security;
alter table generation_log enable row level security;

-- "create policy if not exists" does not exist in Postgres — drop-then-create
-- keeps the block idempotent. Access control lives in the PIN middleware; the
-- app reaches the database only through the service-role key, which bypasses
-- RLS (kept enabled per REQUIREMENTS §6).
drop policy if exists "authenticated full access" on sync_status;
create policy "authenticated full access" on sync_status for all using (auth.role() = 'authenticated');
drop policy if exists "authenticated full access" on generation_log;
create policy "authenticated full access" on generation_log for all using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- Fix round 1 migration (run this block in the Supabase SQL Editor)
-- Idempotent: safe to run more than once.
-- ---------------------------------------------------------------------------

-- C-1: make generation failures queryable without Vercel log access.
alter table generation_log add column if not exists error text;

-- U4: persistent "current injuries / niggles" free text (singleton row).
-- Free text so a future voice-transcript flow can populate it unchanged.
create table if not exists runner_context (
  id boolean primary key default true check (id = true), -- singleton row
  injuries text not null default '',
  updated_at timestamptz not null default now()
);

-- U4: one short feedback note per week, keyed by the Monday it describes.
create table if not exists weekly_feedback (
  week_start_date date primary key,
  feedback text not null,
  updated_at timestamptz not null default now()
);

alter table runner_context enable row level security;
alter table weekly_feedback enable row level security;

drop policy if exists "authenticated full access" on runner_context;
create policy "authenticated full access" on runner_context for all using (auth.role() = 'authenticated');
drop policy if exists "authenticated full access" on weekly_feedback;
create policy "authenticated full access" on weekly_feedback for all using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- Round 2 migration (run this block in the Supabase SQL Editor)
-- Idempotent: safe to run more than once.
-- ---------------------------------------------------------------------------

-- U5: past injuries — permanent structural caution for the planner.
create table if not exists injury_history (
  id bigint generated always as identity primary key,
  description text not null,
  period text not null default '', -- rough free text, e.g. "winter 2024, ~6 weeks off"
  created_at timestamptz not null default now()
);

-- U6: sessions that never reach Strava (gym work, watchless treadmill runs).
-- Deliberately separate from strava_activities (whose PK is the Strava id);
-- the two streams merge in components/data.ts getRecentActivities.
create table if not exists manual_activities (
  id bigint generated always as identity primary key,
  activity_date date not null,
  type text not null,          -- a plan session type or free text
  duration_min integer not null,
  distance_km real,            -- runs with a distance count as running km
  note text,
  created_at timestamptz not null default now()
);

alter table injury_history enable row level security;
alter table manual_activities enable row level security;

drop policy if exists "authenticated full access" on injury_history;
create policy "authenticated full access" on injury_history for all using (auth.role() = 'authenticated');
drop policy if exists "authenticated full access" on manual_activities;
create policy "authenticated full access" on manual_activities for all using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- Round 2b migration (run this block in the Supabase SQL Editor)
-- Idempotent: safe to run more than once.
-- ---------------------------------------------------------------------------

-- U7: review-and-revise. A revision stores the runner's note and when it
-- happened; a fresh generation clears both (the note shows until the next
-- generation).
alter table weekly_plans add column if not exists revision_note text;
alter table weekly_plans add column if not exists revised_at timestamptz;

-- ---------------------------------------------------------------------------
-- V2 migration (run this block in the Supabase SQL Editor)
-- Idempotent: safe to run more than once.
-- ---------------------------------------------------------------------------

-- Away/home status engine (REDESIGN-V2.md): the event's location display
-- name, used to detect non-home-base (not Manchester/London) days.
alter table calendar_events add column if not exists location text;

-- Batch plan editing (REDESIGN-V2.md §Screen 2): queued change requests plus
-- the inline check-in note, per plan week. Applied in one revision call via
-- POST /api/plan/generate { apply_pending: true }; deleted on successful
-- apply.
create table if not exists pending_changes (
  week_start_date date primary key,
  changes jsonb not null default '[]'::jsonb, -- [{ id, date|null, requested_type|null, instruction|null }]
  checkin_note text not null default '',
  updated_at timestamptz not null default now()
);

alter table pending_changes enable row level security;

drop policy if exists "authenticated full access" on pending_changes;
create policy "authenticated full access" on pending_changes for all using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- Voice check-in migration (run this block in the Supabase SQL Editor)
-- Idempotent: safe to run more than once.
-- ---------------------------------------------------------------------------

-- §3.12: the ElevenLabs agent this deployment created (singleton). Recreated
-- automatically whenever lib/elevenlabs.ts's config hash changes.
create table if not exists voice_agent (
  id boolean primary key default true check (id = true), -- singleton row
  agent_id text not null,
  config_hash text not null,
  updated_at timestamptz not null default now()
);

-- §3.12: one row per submit_checkin proposal — the meeting's answers, the
-- Claude proposal read back to the runner, and whether it was applied.
create table if not exists voice_checkins (
  id uuid primary key default gen_random_uuid(),
  week_start_date date not null,   -- plan week the changes target
  described_week date not null,    -- week the feedback note describes
  answers_json jsonb not null,
  proposal_json jsonb not null,
  status text not null default 'proposed' check (status in ('proposed', 'applied', 'discarded')),
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

alter table voice_agent enable row level security;
alter table voice_checkins enable row level security;

drop policy if exists "authenticated full access" on voice_agent;
create policy "authenticated full access" on voice_agent for all using (auth.role() = 'authenticated');
drop policy if exists "authenticated full access" on voice_checkins;
create policy "authenticated full access" on voice_checkins for all using (auth.role() = 'authenticated');
