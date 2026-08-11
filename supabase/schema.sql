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
