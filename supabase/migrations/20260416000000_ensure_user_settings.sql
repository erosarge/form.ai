-- Ensure user_settings table exists with all required columns and RLS policies.
-- Safe to run multiple times (all statements are idempotent).

create table if not exists public.user_settings (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  athlete_name        text,
  height_cm           numeric,
  weight_kg           numeric,
  goal_5k             text,
  goal_10k            text,
  goal_half_marathon  text,
  goal_marathon       text,
  other_goals         text,
  updated_at          timestamptz not null default now(),
  constraint user_settings_user_id_unique unique (user_id)
);

-- Enable RLS (no-op if already enabled)
alter table public.user_settings enable row level security;

-- Drop and recreate policies so they are always current
drop policy if exists "Users can read their own settings"   on public.user_settings;
drop policy if exists "Users can upsert their own settings" on public.user_settings;
drop policy if exists "Users can update their own settings" on public.user_settings;

create policy "Users can read their own settings"
  on public.user_settings for select
  using (auth.uid() = user_id);

create policy "Users can upsert their own settings"
  on public.user_settings for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own settings"
  on public.user_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
