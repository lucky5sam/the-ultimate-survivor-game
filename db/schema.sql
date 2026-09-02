-- ========== Schema for The Ultimate Survivor Game ==========
--
-- Reconstructed from the live database (information_schema) during the 2026
-- security review. This reflects the REAL current tables — the previous
-- version of this file had drifted badly (missing tables, renamed columns).
--
-- Scope & limitations of this reconstruction (read before trusting it 1:1):
--   * Columns, types, NOT NULL, defaults, primary keys, UNIQUE constraints
--     and foreign-key *targets* are accurate (pulled from information_schema).
--   * ON DELETE / ON UPDATE actions are NOT recorded by that source and are
--     INFERRED here: `on delete cascade` is applied to team-owned child rows
--     (so deleting a team/profile cleans up its data), matching prior intent.
--     Verify against the live DB if a delete-rule detail matters.
--   * CHECK constraints, indexes (beyond those implied by PK/UNIQUE),
--     triggers, and functions are NOT captured here. Notably:
--       - the `profiles_no_self_admin` BEFORE UPDATE trigger (blocks privilege
--         escalation on is_admin) exists in the DB but is not defined here.
--       - the `is_admin()` helper used by policies lives in the DB.
--   * RLS policies and the `public_profiles` view are in db/policies.sql,
--     which is the source of truth for the security model — not this file.
--
-- For a byte-exact dump use: `supabase db dump --schema public -f db/schema.sql`.
-- =============================================================================


-- ---------- Core identity & season setup --------------------------------

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,               -- set by the signup trigger; NOT NULL
  is_admin boolean not null default false,  -- guarded by the profiles_no_self_admin trigger
  created_at timestamptz default now(),
  first_name text,
  last_name text,
  payment_method text,                      -- '' | 'venmo' | 'zelle' | 'other'
  payment_handle text,                      -- SENSITIVE: never expose via public_profiles
  payment_note text,                        -- SENSITIVE
  avatar_url text
);

create table seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'upcoming',
  current_episode_id uuid,                  -- FK added below (references episodes)
  merge_episode_id uuid,                    -- FK added below (references episodes)
  bounty_points_pre_merge int not null default 5,
  bounty_points_post_merge int not null default 10,
  swap_penalty_mvp int not null default 15,
  swap_penalty_player int not null default 10,
  grace_period_through_episode int not null default 1,
  created_at timestamptz default now(),
  max_swaps int,
  swap_penalty_role_change int not null default 5,
  bounty_points_finale int not null default 15,
  starts_at timestamptz
);

create table episodes (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  number int not null,
  title text,
  air_date date,
  status text not null default 'upcoming',
  is_merge boolean not null default false,
  is_finale boolean not null default false,
  bounty_contestant_id uuid,                -- FK added below (references contestants)
  locks_at timestamptz,
  unique (season_id, number)
);

create table contestants (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  photo_url text,
  eliminated_episode_id uuid references episodes(id),
  created_at timestamptz default now(),
  bio text,
  age int,
  hometown text,
  occupation text,
  alt_image text,
  video_url text,
  contestant_id int not null unique,        -- stable external/integer id
  first_name text not null,
  last_name text,
  preferred_name text
);

-- Cross-table FKs that couldn't be added until both tables existed (circular).
alter table seasons
  add constraint seasons_current_episode_fk
  foreign key (current_episode_id) references episodes(id);

alter table seasons
  add constraint seasons_merge_episode_fk
  foreign key (merge_episode_id) references episodes(id);

alter table episodes
  add constraint episodes_bounty_contestant_id_fkey
  foreign key (bounty_contestant_id) references contestants(id);


-- ---------- Scoring configuration ---------------------------------------

-- Action catalog is now season-agnostic; per-season points/order live in
-- season_action_types (the old action_types.season_id column was dropped).
create table action_types (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  category text not null,
  points int not null,
  description text,
  sort_order int not null default 0
);

create table season_action_types (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  action_type_id uuid not null references action_types(id),
  points int not null default 0,
  sort_order int not null default 0,
  unique (season_id, action_type_id)
);


-- ---------- Tribes & tribe history --------------------------------------

create table tribes (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  name text not null,
  color text not null,
  created_at timestamptz not null default now(),
  unique (season_id, name)
);

-- Append-only: a contestant's tribe over time (never updated in place).
create table contestant_tribe_assignments (
  id uuid primary key default gen_random_uuid(),
  contestant_id uuid not null references contestants(id),
  tribe text not null,
  effective_from_episode int not null,
  effective_to_episode int,
  unique (contestant_id, effective_from_episode)
);


-- ---------- Teams & rosters ---------------------------------------------

create table teams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  season_id uuid not null references seasons(id),
  team_name text,
  team_image_url text,
  team_emoji text,
  team_color text,
  unique (user_id, season_id)
);

-- Append-only: roster membership over time (swaps are new inserts).
create table team_players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  contestant_id uuid not null references contestants(id),
  role text not null,                       -- 'mvp' | 'player'
  effective_from_episode int not null,
  effective_to_episode int,
  created_at timestamptz default now()
);

-- Audit trail of swaps (drives swap penalties on the leaderboard).
create table team_swaps (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  season_id uuid not null references seasons(id),
  swap_type varchar not null,
  removed_contestant_id uuid references contestants(id),
  added_contestant_id uuid references contestants(id),
  effective_from_episode int not null,
  penalty_points int not null default 0,    -- stored negative; subtracts directly
  created_at timestamptz default now()
);


-- ---------- Bounties -----------------------------------------------------

-- Resolved bounty outcomes per team/episode.
create table bounties (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  episode_id uuid not null references episodes(id),
  contestant_id uuid not null references contestants(id),
  was_correct boolean,
  points_awarded int not null default 0,
  unique (team_id, episode_id)
);

-- Append-only: a team's bounty pick over time (new pick = new insert).
create table bounty_picks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  season_id uuid not null references seasons(id),
  contestant_id uuid not null references contestants(id),
  effective_from_episode int not null default 1,
  created_at timestamptz default now(),
  unique (team_id, effective_from_episode)
);


-- ---------- Episode results (admin-entered) ------------------------------

create table contestant_actions (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id),
  contestant_id uuid not null references contestants(id),
  action_type_id uuid not null references action_types(id),
  count int not null default 1,
  note text,
  created_at timestamptz default now(),
  created_by uuid references profiles(id)
);

create table episode_votes (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id),
  voter_contestant_id uuid not null references contestants(id),
  target_contestant_id uuid not null references contestants(id),
  nullified boolean not null default false,
  created_at timestamptz not null default now()
);

-- Per-team penalty/adjustment ledger.
create table transactions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  episode_id uuid not null references episodes(id),
  type text not null,
  penalty_points int not null default 0,
  payload jsonb,
  created_at timestamptz default now()
);


-- ---------- League config & ops -----------------------------------------

-- Singleton row (id = 1). registration_code is the league join code — kept
-- admin-only in RLS on purpose (never expose it to non-admins).
create table league_settings (
  id bigint primary key default 1,
  registration_code text not null
);

-- Keepalive target for the GitHub Action (see db/keepalive.sql). RLS on, no
-- policies: only service_role (which bypasses RLS) can write it.
create table keepalive (
  id int primary key,
  last_ping timestamptz not null default now()
);
