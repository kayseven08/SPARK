-- =====================================================================
-- SPARK — Supabase schema v2 (normalized, RLS-first, Realtime-ready)
-- Location in repo: client/supabase/schema.sql   (replaces the old file)
--
-- Safe to re-run: no destructive statements (no DROP TABLE).
-- Already applied to the live SPARK project as the migrations
--   spark_schema_v2_normalized + spark_schema_v2_tighten_grants.
-- Use this file to bootstrap a NEW/empty Supabase project.
--
-- Auth setup for a new project (dashboard):
--   Authentication -> Providers -> Email -> turn OFF "Confirm email".
--   (The old auto-confirm trigger on auth.users is intentionally NOT part of
--    this file; the dashboard toggle does the same thing without touching the
--    auth schema.)
--
-- Design summary
--   users            1:1 profile for auth.users (created by trigger)
--   groups           a user's device cluster
--   devices          client + server devices in ONE table (type enum)
--   commands         one row per device command   (was jsonb array)
--   command_presets  group-level command templates (was jsonb array)
--   messages         one row per message          (was copied into 3 jsonb arrays)
--   ai_messages      per-group LLM chat history   (was jsonb array)
--   groups_with_devices  view: group + {client:[ids], server:[ids]} for the UI
--   Realtime: only public.messages is published (INSERT -> device listener).
-- =====================================================================

create schema if not exists private;

do $$ begin
  create type public.device_type as enum ('client', 'server');
exception when duplicate_object then null; end $$;

-- ── helper functions ──────────────────────────────────────────────────
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function private.derive_username(p_meta text, p_email text, p_id uuid)
returns text language plpgsql set search_path = '' as $$
declare v text;
begin
  v := left(coalesce(nullif(trim(p_meta), ''), split_part(p_email, '@', 1)), 32);
  if char_length(v) < 2 then v := v || '_user'; end if;
  if exists (select 1 from public.users where lower(username) = lower(v)) then
    v := left(v, 27) || '_' || substr(p_id::text, 1, 4);
  end if;
  return v;
end $$;

-- ── users (profile, 1:1 with auth.users) ──────────────────────────────
create table if not exists public.users (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,                       -- mirror of auth email (synced by trigger)
  username     text not null,
  settings     jsonb not null default '{"primaryCommunicationMethod":"realtime"}'::jsonb,
  integrations jsonb not null default '[]'::jsonb,  -- intentionally jsonb: unstructured, low-traffic
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint users_username_len check (char_length(username) between 2 and 32)
);
create unique index if not exists users_username_lower_key on public.users (lower(username));

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at before update on public.users
  for each row execute function private.set_updated_at();

-- ── groups ────────────────────────────────────────────────────────────
create table if not exists public.groups (
  id               uuid primary key default gen_random_uuid(),
  assigned_user_id uuid not null references public.users (id) on delete cascade,
  name             text not null default 'New Group' check (char_length(trim(name)) between 1 and 80),
  settings         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, assigned_user_id)                     -- target for composite ownership FKs
);
create index if not exists groups_assigned_user_id_idx on public.groups (assigned_user_id);

drop trigger if exists groups_set_updated_at on public.groups;
create trigger groups_set_updated_at before update on public.groups
  for each row execute function private.set_updated_at();

-- ── devices (client + server unified) ─────────────────────────────────
create table if not exists public.devices (
  id                uuid primary key default gen_random_uuid(),
  assigned_user_id  uuid not null references public.users (id) on delete cascade,
  assigned_group_id uuid not null,
  type              public.device_type not null,
  name              text not null check (char_length(trim(name)) between 1 and 80),
  aliases           text[] not null default '{}',
  settings          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, assigned_user_id),
  -- a device's group must belong to the same user; deleting a group deletes its devices
  constraint devices_group_owner_fkey
    foreign key (assigned_group_id, assigned_user_id)
    references public.groups (id, assigned_user_id) on delete cascade
);
create index if not exists devices_assigned_user_id_idx  on public.devices (assigned_user_id);
create index if not exists devices_assigned_group_id_idx on public.devices (assigned_group_id);
-- voice routing resolves devices by name -> names must be unique within a group
create unique index if not exists devices_group_name_key on public.devices (assigned_group_id, lower(name));

drop trigger if exists devices_set_updated_at on public.devices;
create trigger devices_set_updated_at before update on public.devices
  for each row execute function private.set_updated_at();

-- ── commands (per device) ─────────────────────────────────────────────
create table if not exists public.commands (
  id               uuid primary key default gen_random_uuid(),
  device_id        uuid not null,
  assigned_user_id uuid not null,
  name             text not null check (char_length(trim(name)) > 0),
  command          text not null check (char_length(trim(command)) > 0),
  aliases          text[] not null default '{}',
  created_at       timestamptz not null default now(),
  unique (device_id, name),
  foreign key (device_id, assigned_user_id)
    references public.devices (id, assigned_user_id) on delete cascade
);
create index if not exists commands_assigned_user_id_idx on public.commands (assigned_user_id);

-- ── command_presets (group-level templates) ───────────────────────────
create table if not exists public.command_presets (
  id                uuid primary key default gen_random_uuid(),
  assigned_group_id uuid not null,
  assigned_user_id  uuid not null,
  name              text not null check (char_length(trim(name)) > 0),
  command           text not null check (char_length(trim(command)) > 0),
  aliases           text[] not null default '{}',
  created_at        timestamptz not null default now(),
  unique (assigned_group_id, name),
  foreign key (assigned_group_id, assigned_user_id)
    references public.groups (id, assigned_user_id) on delete cascade
);
create index if not exists command_presets_assigned_user_id_idx on public.command_presets (assigned_user_id);

-- ── messages ──────────────────────────────────────────────────────────
-- A device's "inbox" = rows where to_device_id = device; "sent" = from_device_id.
create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  assigned_user_id uuid not null references public.users (id) on delete cascade,
  from_device_id   uuid references public.devices (id) on delete set null,
  to_device_id     uuid not null references public.devices (id) on delete cascade,
  content          text not null check (char_length(content) between 1 and 4000),
  status           smallint not null default 0 check (status between 0 and 2),
  created_at       timestamptz not null default now()
);
comment on column public.messages.status is '0 = pending, 1 = handled, 2 = failed';
create index if not exists messages_to_device_idx   on public.messages (to_device_id, created_at desc);
create index if not exists messages_from_device_idx on public.messages (from_device_id, created_at desc);
create index if not exists messages_user_idx        on public.messages (assigned_user_id);

-- ── ai_messages (per-group LLM history) ───────────────────────────────
create table if not exists public.ai_messages (
  id                bigint generated always as identity primary key,
  assigned_group_id uuid not null,
  assigned_user_id  uuid not null,
  role              text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content           text not null,
  created_at        timestamptz not null default now(),
  foreign key (assigned_group_id, assigned_user_id)
    references public.groups (id, assigned_user_id) on delete cascade
);
create index if not exists ai_messages_group_idx on public.ai_messages (assigned_group_id, id);
create index if not exists ai_messages_user_idx  on public.ai_messages (assigned_user_id);

-- ── view: group + device id lists (keeps group.devices.client/server in the UI) ──
create or replace view public.groups_with_devices
with (security_invoker = true) as
select g.id, g.name, g.assigned_user_id, g.settings, g.created_at, g.updated_at,
  jsonb_build_object(
    'client', coalesce(jsonb_agg(d.id order by d.created_at) filter (where d.type = 'client'), '[]'::jsonb),
    'server', coalesce(jsonb_agg(d.id order by d.created_at) filter (where d.type = 'server'), '[]'::jsonb)
  ) as devices
from public.groups g
left join public.devices d on d.assigned_group_id = g.id
group by g.id;

-- ── Row Level Security ────────────────────────────────────────────────
alter table public.users           enable row level security;
alter table public.groups          enable row level security;
alter table public.devices         enable row level security;
alter table public.commands        enable row level security;
alter table public.command_presets enable row level security;
alter table public.messages        enable row level security;
alter table public.ai_messages     enable row level security;

-- users: read/update own row; rows are created only by the auth trigger
drop policy if exists "users_select_own" on public.users;
drop policy if exists "users_insert_own" on public.users;
drop policy if exists "users_update_own" on public.users;
drop policy if exists "users_delete_own" on public.users;
drop policy if exists users_select_own   on public.users;
drop policy if exists users_update_own   on public.users;
create policy users_select_own on public.users for select to authenticated
  using (id = (select auth.uid()));
create policy users_update_own on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists groups_own          on public.groups;
drop policy if exists devices_own         on public.devices;
drop policy if exists commands_own        on public.commands;
drop policy if exists command_presets_own on public.command_presets;
drop policy if exists ai_messages_own     on public.ai_messages;

create policy groups_own on public.groups for all to authenticated
  using (assigned_user_id = (select auth.uid()))
  with check (assigned_user_id = (select auth.uid()));
create policy devices_own on public.devices for all to authenticated
  using (assigned_user_id = (select auth.uid()))
  with check (assigned_user_id = (select auth.uid()));
create policy commands_own on public.commands for all to authenticated
  using (assigned_user_id = (select auth.uid()))
  with check (assigned_user_id = (select auth.uid()));
create policy command_presets_own on public.command_presets for all to authenticated
  using (assigned_user_id = (select auth.uid()))
  with check (assigned_user_id = (select auth.uid()));
create policy ai_messages_own on public.ai_messages for all to authenticated
  using (assigned_user_id = (select auth.uid()))
  with check (assigned_user_id = (select auth.uid()));

-- messages: sender and receiver must both be the caller's own devices
drop policy if exists messages_select_own on public.messages;
drop policy if exists messages_insert_own on public.messages;
drop policy if exists messages_update_own on public.messages;
drop policy if exists messages_delete_own on public.messages;
create policy messages_select_own on public.messages for select to authenticated
  using (assigned_user_id = (select auth.uid()));
create policy messages_insert_own on public.messages for insert to authenticated
  with check (
    assigned_user_id = (select auth.uid())
    and exists (select 1 from public.devices d
                where d.id = to_device_id and d.assigned_user_id = (select auth.uid()))
    and (from_device_id is null or exists (select 1 from public.devices d
                where d.id = from_device_id and d.assigned_user_id = (select auth.uid())))
  );
create policy messages_update_own on public.messages for update to authenticated
  using (assigned_user_id = (select auth.uid()))
  with check (assigned_user_id = (select auth.uid()));
create policy messages_delete_own on public.messages for delete to authenticated
  using (assigned_user_id = (select auth.uid()));

-- ── Grants: least privilege (Supabase default ACLs grant far too much) ──
revoke all on public.users, public.groups, public.devices, public.commands,
              public.command_presets, public.messages, public.ai_messages,
              public.groups_with_devices
  from anon, authenticated;

grant select on public.users to authenticated;
grant update (username, settings, integrations) on public.users to authenticated;  -- NOT id/email

grant select, insert, update, delete on public.groups, public.devices, public.commands,
      public.command_presets, public.ai_messages to authenticated;

grant select, insert, delete on public.messages to authenticated;
grant update (status) on public.messages to authenticated;                         -- content is immutable

grant select on public.groups_with_devices to authenticated;
grant all on public.users, public.groups, public.devices, public.commands,
      public.command_presets, public.messages, public.ai_messages,
      public.groups_with_devices to service_role;

-- ── Auth triggers ─────────────────────────────────────────────────────
-- Profile row is created ONLY here; the client must never insert into public.users.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, email, username)
  values (new.id, new.email,
          private.derive_username(new.raw_user_meta_data->>'username', new.email, new.id))
  on conflict (id) do nothing;
  return new;
end $$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.sync_user_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.users set email = new.email where id = new.id;
  return new;
end $$;
revoke all on function private.sync_user_email() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.sync_user_email();

-- backfill profiles for auth users created before this schema existed
do $$
declare r record;
begin
  for r in select id, email, raw_user_meta_data->>'username' as uname
           from auth.users order by created_at
  loop
    insert into public.users (id, email, username)
    values (r.id, r.email, private.derive_username(r.uname, r.email, r.id))
    on conflict (id) do nothing;
  end loop;
end $$;

-- ── RPCs ──────────────────────────────────────────────────────────────
-- Pre-login username check for the register form (callable by anon on purpose).
create or replace function public.is_username_available(p_username text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.users where lower(username) = lower(trim(p_username))
  );
$$;
revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;

-- Copies a group preset onto every device in that group (skips existing names).
-- SECURITY INVOKER: RLS applies, so it can only touch the caller's own rows.
create or replace function public.apply_command_preset(p_preset_id uuid)
returns integer language sql security invoker set search_path = '' as $$
  with ins as (
    insert into public.commands (device_id, assigned_user_id, name, command, aliases)
    select d.id, d.assigned_user_id, p.name, p.command, p.aliases
    from public.command_presets p
    join public.devices d on d.assigned_group_id = p.assigned_group_id
    where p.id = p_preset_id
    on conflict (device_id, name) do nothing
    returning 1
  )
  select count(*)::int from ins;
$$;
revoke all on function public.apply_command_preset(uuid) from public, anon;
grant execute on function public.apply_command_preset(uuid) to authenticated;

-- ── Realtime: push only new/changed messages ──────────────────────────
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
