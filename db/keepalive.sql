-- Keepalive table for the Supabase Keepalive GitHub Action.
-- Run this once, manually, in the Supabase SQL editor.
--
-- The action does a real UPDATE against this table every 2 days using the
-- service_role key. A write is far more likely to count as project activity
-- (and prevent the free-tier 7-day inactivity pause) than an anonymous read.
--
-- RLS is enabled with NO policies, so anon/authenticated cannot touch it.
-- service_role bypasses RLS, so only the CI job (which holds that key) can write.

create table if not exists public.keepalive (
  id        int primary key,
  last_ping timestamptz not null default now()
);

-- Single fixed row the action updates.
insert into public.keepalive (id) values (1)
  on conflict (id) do nothing;

alter table public.keepalive enable row level security;
