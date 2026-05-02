-- ========== Schema for The Ultimate Survivor Game ==========

create table seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'upcoming',
  current_episode_id uuid,
  merge_episode_id uuid,
  bounty_points_pre_merge int not null default 5,
  bounty_points_post_merge int not null default 10,
  swap_penalty_mvp int not null default 15,
  swap_penalty_player int not null default 10,
  grace_period_through_episode int not null default 1,
  created_at timestamptz default now()
);

create table contestants (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  name text not null,
  photo_url text,
  eliminated_episode_id uuid,
  created_at timestamptz default now()
);

create table episodes (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  number int not null,
  title text,
  air_date date,
  status text not null default 'upcoming',
  unique (season_id, number)
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  is_admin boolean not null default false,
  created_at timestamptz default now()
);

create table action_types (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  type text not null,
  category text not null,
  points int not null,
  description text,
  sort_order int not null default 0,
  unique (season_id, category)
);

create table contestant_tribe_assignments (
  id uuid primary key default gen_random_uuid(),
  contestant_id uuid not null references contestants(id),
  tribe text not null,
  effective_from_episode int not null,
  effective_to_episode int,
  unique (contestant_id, effective_from_episode)
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  season_id uuid not null references seasons(id),
  team_name text,
  unique (user_id, season_id)
);

create table team_players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  contestant_id uuid not null references contestants(id),
  role text not null,
  effective_from_episode int not null,
  effective_to_episode int,
  created_at timestamptz default now()
);

create table bounties (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  episode_id uuid not null references episodes(id),
  contestant_id uuid not null references contestants(id),
  was_correct boolean,
  points_awarded int not null default 0,
  unique (team_id, episode_id)
);

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

create table transactions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  episode_id uuid not null references episodes(id),
  type text not null,
  penalty_points int not null default 0,
  payload jsonb,
  created_at timestamptz default now()
);

-- Cross-table FKs we couldn't add until both tables existed
alter table seasons
  add constraint seasons_current_episode_fk
  foreign key (current_episode_id) references episodes(id);

alter table seasons
  add constraint seasons_merge_episode_fk
  foreign key (merge_episode_id) references episodes(id);

alter table contestants
  add constraint contestants_eliminated_episode_fk
  foreign key (eliminated_episode_id) references episodes(id);