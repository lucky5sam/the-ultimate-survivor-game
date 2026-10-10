-- League Chat (added 2026-10-06). Run this once, manually, in the Supabase SQL
-- editor, THEN re-run db/policies.sql (it holds the chat RLS policies and
-- would fail if these tables didn't exist yet).
--
-- Threads are admin-controlled: every episode gets one automatically (trigger
-- below), and admins can add custom threads. Players can only reply.

begin;

-- One discussion thread. episode_id ties it to an episode for Spoiler
-- Protection (players capped before that episode can't open it); null means a
-- general thread anyone can read. Episode threads have no title of their own —
-- the app shows "Episode N: <episode title>" unless an admin sets one.
create table if not exists chat_threads (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  episode_id uuid references episodes(id) on delete cascade,
  kind text not null default 'custom' check (kind in ('episode', 'custom')),
  title text,
  description text,
  image_url text,                            -- 2:1 cover image (admin-set)
  is_locked boolean not null default false,  -- admin closed replies
  last_message_at timestamptz,               -- kept current by a trigger; drives unread badges
  message_count integer not null default 0,  -- kept current by triggers; the feed's reply count
  is_highlight boolean not null default false, -- admin-featured thread (League Home)
  created_at timestamptz not null default now()
);

-- Added 2026-10-10, for databases created before image_url was in the table above.
alter table chat_threads add column if not exists image_url text;
alter table chat_threads add column if not exists message_count integer not null default 0;
alter table chat_threads add column if not exists is_highlight boolean not null default false;

-- Exactly one automatic thread per episode.
create unique index if not exists chat_threads_one_per_episode
  on chat_threads (episode_id) where kind = 'episode';

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_thread_created
  on chat_messages (thread_id, created_at);

-- Added 2026-10-10: replies capped at 500 characters (was 2000). The inline
-- check on body is named chat_messages_body_check by Postgres.
alter table chat_messages drop constraint if exists chat_messages_body_check;
alter table chat_messages
  add constraint chat_messages_body_check check (char_length(body) between 1 and 500);

-- Players muted from posting. Its own admin-only table rather than a profiles
-- column, because players can update their own profile row.
create table if not exists chat_mutes (
  user_id uuid primary key references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Every new episode gets its thread automatically.
create or replace function chat_create_episode_thread() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into chat_threads (season_id, episode_id, kind)
  values (new.season_id, new.id, 'episode')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists episodes_create_chat_thread on episodes;
create trigger episodes_create_chat_thread
  after insert on episodes
  for each row execute function chat_create_episode_thread();

-- Bump the thread's last_message_at on each new message. SECURITY DEFINER
-- because players can't update threads themselves.
create or replace function chat_touch_thread() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  update chat_threads
    set last_message_at = new.created_at, message_count = message_count + 1
    where id = new.thread_id;
  return new;
end;
$$;

-- Messages are always stamped with the server's time, so a player can't
-- back- or future-date one through the API (it would skew "latest reply" and
-- unread badges for everyone).
create or replace function chat_messages_stamp() returns trigger
  language plpgsql as $$
begin
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists chat_messages_stamp on chat_messages;
create trigger chat_messages_stamp
  before insert on chat_messages
  for each row execute function chat_messages_stamp();

drop trigger if exists chat_messages_touch_thread on chat_messages;
create trigger chat_messages_touch_thread
  after insert on chat_messages
  for each row execute function chat_touch_thread();

-- A deleted message comes off its thread's reply count, and last_message_at
-- falls back to the newest message still there (null if none).
create or replace function chat_untouch_thread() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  update chat_threads
    set message_count = greatest(message_count - 1, 0),
        last_message_at = (select max(created_at) from chat_messages where thread_id = old.thread_id)
    where id = old.thread_id;
  return old;
end;
$$;

drop trigger if exists chat_messages_untouch_thread on chat_messages;
create trigger chat_messages_untouch_thread
  after delete on chat_messages
  for each row execute function chat_untouch_thread();

-- Backfill reply counts for messages posted before message_count existed.
update chat_threads t
  set message_count = (select count(*) from chat_messages m where m.thread_id = t.id);

-- Backfill: a thread for every episode that already exists.
insert into chat_threads (season_id, episode_id, kind)
select season_id, id, 'episode' from episodes
on conflict do nothing;

-- Let the app subscribe to live changes (Supabase Realtime still applies RLS).
-- Guarded so re-running this file doesn't fail (and roll everything back).
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'chat_threads') then
    alter publication supabase_realtime add table chat_threads;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table chat_messages;
  end if;
end;
$$;

commit;
