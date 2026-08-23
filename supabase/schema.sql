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
