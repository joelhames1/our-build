-- Our Build: managed accounts. Run after 0001_init.sql; safe to run more than once.
--
-- members is the allow-list. Anyone can create a Supabase login (Google or an email link), but
-- the app only lets in people whose email is here, and the data rules below only open up for
-- *active* members. Invites, roles and disabling/archiving/deleting are done by the server with
-- the service role key; signed-in people can only read.

create extension if not exists pgcrypto;

-- People ----------------------------------------------------------------------------------------
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  name text not null default '',
  role text not null default 'member' check (role in ('admin', 'member')),
  -- invited: on the list, hasn't signed in yet; active: in; disabled: paused by an admin;
  -- archived: retired (hidden from the main list, can be restored).
  status text not null default 'invited' check (status in ('invited', 'active', 'disabled', 'archived')),
  user_id uuid unique references auth.users (id) on delete set null,
  invited_by uuid references public.members (id) on delete set null,
  invited_at timestamptz,
  invite_sent_at timestamptz,
  activated_at timestamptz,
  last_sign_in_at timestamptz,
  status_changed_at timestamptz,
  status_changed_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists members_status on public.members (status);

drop trigger if exists members_touch on public.members;
create trigger members_touch before update on public.members
  for each row execute function public.touch_updated_at();

-- What happened to whom, and who did it. Kept after an account is deleted.
create table if not exists public.member_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  kind text not null,
  email text not null,
  member_id uuid references public.members (id) on delete set null,
  actor_id uuid references public.members (id) on delete set null,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists member_events_at on public.member_events (at desc);

-- Rate limits for the sign-in link form: one counter per key and window.
create table if not exists public.rate_limits (
  key text primary key,
  count integer not null default 0,
  expires_at timestamptz not null
);

-- Counts one hit and returns the count in its window, in one step, so two requests at the same
-- moment can't both slip under the limit. Now and then it clears out windows that have ended.
create or replace function public.rate_hit(p_key text, p_expires timestamptz)
returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  insert into rate_limits as r (key, count, expires_at)
  values (p_key, 1, p_expires)
  on conflict (key) do update
    set count = case when r.expires_at < now() then 1 else r.count + 1 end,
        expires_at = case when r.expires_at < now() then excluded.expires_at else r.expires_at end
  returning r.count into n;
  if random() < 0.02 then
    delete from rate_limits where expires_at < now();
  end if;
  return n;
end;
$$;

-- Who's in ----------------------------------------------------------------------------------------
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.members where user_id = auth.uid() and status = 'active');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.members where user_id = auth.uid() and status = 'active' and role = 'admin');
$$;

-- The data policies from 0001 call is_household(); it now means "an active member".
create or replace function public.is_household()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_member();
$$;

revoke all on function public.is_member() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.is_household() from public;
grant execute on function public.is_member() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_household() to authenticated;

-- Row level security ------------------------------------------------------------------------------
alter table public.members enable row level security;
alter table public.member_events enable row level security;
alter table public.rate_limits enable row level security;

drop policy if exists "members see the members" on public.members;
create policy "members see the members" on public.members
  for select to authenticated using (public.is_member());

drop policy if exists "admins see the activity" on public.member_events;
create policy "admins see the activity" on public.member_events
  for select to authenticated using (public.is_admin());

revoke all on table public.rate_limits from anon, authenticated;
revoke insert, update, delete on table public.members, public.member_events from anon, authenticated;
grant select, insert, update, delete on table public.members, public.member_events, public.rate_limits to service_role;
revoke all on function public.rate_hit(text, timestamptz) from public, anon, authenticated;
grant execute on function public.rate_hit(text, timestamptz) to service_role;

-- Bring over the old household list --------------------------------------------------------------
do $$ begin
  if to_regclass('public.household') is not null then
    insert into public.members (email, status, invited_at)
    select lower(email), 'invited', added_at from public.household
    on conflict (email) do nothing;
  end if;
end $$;
-- The household table is no longer used; drop it whenever you like:
-- drop table if exists public.household;
