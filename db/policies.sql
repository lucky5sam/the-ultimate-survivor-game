-- ========================================================================
-- Row Level Security policies for The Ultimate Survivor Game
-- ========================================================================
--
-- This file is the SOURCE OF TRUTH for the app's RLS policies. The live
-- database is the only other copy (policies are applied by hand in the
-- Supabase SQL editor), so keep the two in sync: when you change a policy in
-- Supabase, mirror it here in the same PR.
--
-- Running this whole file is SAFE and idempotent: it drops every policy by
-- its known name (old duplicates included) and recreates the canonical set.
-- It is functionally equivalent to the policies that were live as of the
-- 2026 security review, EXCEPT that it removes redundant duplicate policies
-- and normalizes every admin check to the is_admin() helper. No grant a user
-- had before is taken away; the only reads removed were the two wide-open
-- `using (true)` policies on `profiles` that leaked payment info.
--
-- Behavioral choices intentionally PRESERVED (not changed here so this file
-- can't silently alter the security model):
--   * bounty_picks / team_swaps have no admin-write policy — admins cannot
--     edit these directly. Add a *_admin policy if that's wrong.
--   * league_settings is admin-only (no non-admin read). This is CORRECT and
--     deliberate: it holds registration_code (the league join code), which
--     must never be readable via the API. Do NOT add a public read policy.
--
-- Prerequisite: the is_admin() helper must exist. It should be SECURITY
-- DEFINER so it can read `profiles` without tripping that table's own RLS
-- (otherwise policies that call it on other tables would recurse). Expected
-- shape (paste your real one here once confirmed via pg_get_functiondef):
--
--   create or replace function is_admin() returns boolean
--     language sql security definer stable set search_path = public as $$
--       select coalesce((select is_admin from profiles where id = auth.uid()), false);
--     $$;
--
-- Privilege escalation on profiles.is_admin is blocked separately by the
-- `profiles_no_self_admin` BEFORE UPDATE trigger (not defined in this file).
-- ========================================================================


-- ---------- Make sure RLS is on for every table -------------------------
-- (Harmless if already enabled. A table with RLS OFF ignores its policies.)
alter table action_types                 enable row level security;
alter table bounties                      enable row level security;
alter table bounty_picks                  enable row level security;
alter table contestant_actions            enable row level security;
alter table contestant_tribe_assignments  enable row level security;
alter table contestants                   enable row level security;
alter table episode_votes                 enable row level security;
alter table episodes                      enable row level security;
alter table keepalive                     enable row level security;
alter table league_settings               enable row level security;
alter table profiles                      enable row level security;
alter table season_action_types           enable row level security;
alter table seasons                       enable row level security;
alter table team_players                  enable row level security;
alter table team_swaps                    enable row level security;
alter table teams                         enable row level security;
alter table transactions                  enable row level security;
alter table tribes                        enable row level security;


-- ---------- action_types ------------------------------------------------
drop policy if exists "action_types_admin" on action_types;
drop policy if exists "action_types_read" on action_types;
drop policy if exists "Authenticated users can read action_types" on action_types;

create policy "action_types_read" on action_types
  for select to authenticated using (true);
create policy "action_types_admin" on action_types
  for all to authenticated using (is_admin()) with check (is_admin());


-- ---------- bounties ----------------------------------------------------
drop policy if exists "bounties_admin" on bounties;
drop policy if exists "bounties_write_own" on bounties;
drop policy if exists "bounties_read" on bounties;

create policy "bounties_read" on bounties
  for select to authenticated using (true);
create policy "bounties_admin" on bounties
  for all to authenticated using (is_admin()) with check (is_admin());
create policy "bounties_write_own" on bounties
  for all to authenticated
  using (exists (select 1 from teams t where t.id = bounties.team_id and t.user_id = auth.uid()))
  with check (exists (select 1 from teams t where t.id = bounties.team_id and t.user_id = auth.uid()));


-- ---------- bounty_picks ------------------------------------------------
-- NOTE: no admin-write policy here (see header). Owner-managed + open read.
drop policy if exists "Users manage own bounty picks" on bounty_picks;
drop policy if exists "Authenticated read bounty picks" on bounty_picks;

create policy "bounty_picks_read" on bounty_picks
  for select to authenticated using (true);
create policy "bounty_picks_write_own" on bounty_picks
  for all to authenticated
  using (team_id in (select id from teams where user_id = auth.uid()))
  with check (team_id in (select id from teams where user_id = auth.uid()));


-- ---------- contestant_actions ------------------------------------------
drop policy if exists "Admins can manage contestant_actions" on contestant_actions;
drop policy if exists "ca_admin" on contestant_actions;
drop policy if exists "ca_read" on contestant_actions;
drop policy if exists "Authenticated users can read contestant_actions" on contestant_actions;

create policy "contestant_actions_read" on contestant_actions
  for select to authenticated using (true);
create policy "contestant_actions_admin" on contestant_actions
  for all to authenticated using (is_admin()) with check (is_admin());


-- ---------- contestant_tribe_assignments --------------------------------
drop policy if exists "cta_admin" on contestant_tribe_assignments;
drop policy if exists "cta_read" on contestant_tribe_assignments;
drop policy if exists "Authenticated users can read tribe assignments" on contestant_tribe_assignments;

create policy "cta_read" on contestant_tribe_assignments
  for select to authenticated using (true);
create policy "cta_admin" on contestant_tribe_assignments
  for all to authenticated using (is_admin()) with check (is_admin());


-- ---------- contestants -------------------------------------------------
drop policy if exists "contestants_admin" on contestants;
drop policy if exists "contestants_read" on contestants;
drop policy if exists "Authenticated users can read contestants" on contestants;

create policy "contestants_read" on contestants
  for select to authenticated using (true);
create policy "contestants_admin" on contestants
  for all to authenticated using (is_admin()) with check (is_admin());


-- ---------- episode_votes -----------------------------------------------
drop policy if exists "episode_votes admin write" on episode_votes;
drop policy if exists "episode_votes read" on episode_votes;

create policy "episode_votes_read" on episode_votes
  for select to authenticated using (true);
create policy "episode_votes_admin" on episode_votes
  for all to authenticated using (is_admin()) with check (is_admin());


-- ---------- episodes ----------------------------------------------------
drop policy if exists "Admins can manage episodes" on episodes;
drop policy if exists "episodes_admin" on episodes;
drop policy if exists "episodes_read" on episodes;
drop policy if exists "Authenticated users can read episodes" on episodes;

create policy "episodes_read" on episodes
  for select to authenticated using (true);
create policy "episodes_admin" on episodes
  for all to authenticated using (is_admin()) with check (is_admin());


-- ---------- league_settings ---------------------------------------------
-- Admin-only by design: holds registration_code (the league join code), which
-- must never be readable via the API. No non-admin read policy — intentional.
drop policy if exists "admins_manage_league_settings" on league_settings;

create policy "league_settings_admin" on league_settings
  for all to authenticated using (is_admin()) with check (is_admin());


-- ---------- profiles ----------------------------------------------------
-- Payment fields (payment_method/handle/note) must never be readable by
-- other users. SELECT is limited to your own row + admins; everyone else
-- reads names through the public_profiles view (see views section below).
drop policy if exists "profiles_admin_all" on profiles;
drop policy if exists "Users can insert own profile" on profiles;
drop policy if exists "profiles_read_own" on profiles;
drop policy if exists "profiles_update_own" on profiles;
drop policy if exists "Users can update own profile" on profiles;
-- (profiles_read_all and "Authenticated can read profile names" were the two
--  leaky policies removed in the security fix; dropped defensively here too.)
drop policy if exists "profiles_read_all" on profiles;
drop policy if exists "Authenticated can read profile names" on profiles;

create policy "profiles_admin_all" on profiles
  for all to authenticated using (is_admin()) with check (is_admin());
create policy "profiles_read_own" on profiles
  for select to authenticated using (id = auth.uid());
create policy "profiles_insert_own" on profiles
  for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_own" on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());


-- ---------- season_action_types -----------------------------------------
drop policy if exists "admin write" on season_action_types;
drop policy if exists "authenticated read" on season_action_types;

create policy "season_action_types_read" on season_action_types
  for select to authenticated using (true);
create policy "season_action_types_admin" on season_action_types
  for all to authenticated using (is_admin()) with check (is_admin());


-- ---------- seasons -----------------------------------------------------
drop policy if exists "seasons_admin" on seasons;
drop policy if exists "seasons_read" on seasons;

create policy "seasons_read" on seasons
  for select to authenticated using (true);
create policy "seasons_admin" on seasons
  for all to authenticated using (is_admin()) with check (is_admin());


-- ---------- team_players ------------------------------------------------
-- Open read (leaderboard needs every team's roster); owner + admin writes.
drop policy if exists "tp_admin" on team_players;
drop policy if exists "tp_write_own" on team_players;
drop policy if exists "Users can insert own team_players" on team_players;
drop policy if exists "tp_read" on team_players;
drop policy if exists "leaderboard_read_team_players" on team_players;
drop policy if exists "Users can read own team_players" on team_players;
drop policy if exists "Users update own team players" on team_players;

create policy "team_players_read" on team_players
  for select to authenticated using (true);
create policy "team_players_admin" on team_players
  for all to authenticated using (is_admin()) with check (is_admin());
create policy "team_players_write_own" on team_players
  for all to authenticated
  using (exists (select 1 from teams t where t.id = team_players.team_id and t.user_id = auth.uid()))
  with check (exists (select 1 from teams t where t.id = team_players.team_id and t.user_id = auth.uid()));


-- ---------- team_swaps --------------------------------------------------
-- NOTE: no admin-write policy here (see header). Insert-own + open read.
drop policy if exists "Users insert own swaps" on team_swaps;
drop policy if exists "Authenticated read all swaps" on team_swaps;

create policy "team_swaps_read" on team_swaps
  for select to authenticated using (true);
create policy "team_swaps_insert_own" on team_swaps
  for insert to authenticated
  with check (team_id in (select id from teams where user_id = auth.uid()));


-- ---------- teams -------------------------------------------------------
-- Open read (public league — everyone sees every team); owner + admin writes.
drop policy if exists "teams_write_own" on teams;
drop policy if exists "teams_admin" on teams;
drop policy if exists "Users can insert own team" on teams;
drop policy if exists "Users can read own teams" on teams;
drop policy if exists "teams_read" on teams;
drop policy if exists "leaderboard_read_teams" on teams;

create policy "teams_read" on teams
  for select to authenticated using (true);
create policy "teams_admin" on teams
  for all to authenticated using (is_admin()) with check (is_admin());
create policy "teams_write_own" on teams
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ---------- transactions ------------------------------------------------
-- Read only your own team's transactions; admins manage all.
drop policy if exists "tx_admin" on transactions;
drop policy if exists "tx_read_own" on transactions;

create policy "tx_admin" on transactions
  for all to authenticated using (is_admin()) with check (is_admin());
create policy "tx_read_own" on transactions
  for select to authenticated
  using (exists (select 1 from teams t where t.id = transactions.team_id and t.user_id = auth.uid()));


-- ---------- tribes ------------------------------------------------------
drop policy if exists "tribes_admin_write" on tribes;
drop policy if exists "tribes_select" on tribes;

create policy "tribes_read" on tribes
  for select to authenticated using (true);
create policy "tribes_admin" on tribes
  for all to authenticated using (is_admin()) with check (is_admin());


-- ---------- keepalive ---------------------------------------------------
-- Intentionally NO policies: only the service_role (CI keepalive job) may
-- touch it, and service_role bypasses RLS. Leave it locked to anon/auth.


-- ========================================================================
-- Views
-- ========================================================================

-- Name-only projection of profiles for the leaderboard and public team pages.
-- A default view (security_invoker OFF) runs with the view owner's rights, so
-- it bypasses the profiles SELECT policy and exposes ONLY these four columns —
-- never the payment fields — to any authenticated user.
create or replace view public_profiles as
  select id, first_name, last_name, avatar_url
  from profiles;

grant select on public_profiles to authenticated;
