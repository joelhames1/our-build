-- Our Build: projects, version history and conversation, shared by one household.
--
-- Access model: only people listed in public.household can read or write anything, and
-- sign-ups are invite-only (disable "Allow new users to sign up" in Auth settings). Being
-- signed in is not enough on its own; your email must also be in the household list.

create extension if not exists pgcrypto;

-- Who belongs to the household -------------------------------------------------------------
create table if not exists public.household (
  email text primary key,
  added_at timestamptz not null default now()
);

create or replace function public.is_household()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_household() from public;
grant execute on function public.is_household() to authenticated;

alter table public.household enable row level security;
drop policy if exists "household members see the household" on public.household;
create policy "household members see the household" on public.household
  for select to authenticated using (public.is_household());

-- Projects -----------------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled',
  head_version_id uuid,
  thumbnail text,
  sqft integer,
  levels integer,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  parent_id uuid references public.project_versions (id) on delete set null,
  model jsonb not null,
  summary text not null default '',
  source text not null check (source in ('ai', 'user', 'template', 'restore')),
  changes jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists project_versions_project_created on public.project_versions (project_id, created_at);

do $$ begin
  alter table public.projects
    add constraint projects_head_version_fk foreign key (head_version_id)
    references public.project_versions (id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  text text not null,
  changes text,
  version_id uuid references public.project_versions (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_project_created on public.chat_messages (project_id, created_at);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

-- Row level security: the household shares everything ---------------------------------------
alter table public.projects enable row level security;
alter table public.project_versions enable row level security;
alter table public.chat_messages enable row level security;

do $$
declare t text;
begin
  foreach t in array array['projects', 'project_versions', 'chat_messages'] loop
    execute format('drop policy if exists "household select" on public.%I', t);
    execute format('drop policy if exists "household insert" on public.%I', t);
    execute format('drop policy if exists "household update" on public.%I', t);
    execute format('drop policy if exists "household delete" on public.%I', t);
    execute format('create policy "household select" on public.%I for select to authenticated using (public.is_household())', t);
    execute format('create policy "household insert" on public.%I for insert to authenticated with check (public.is_household())', t);
    execute format('create policy "household update" on public.%I for update to authenticated using (public.is_household()) with check (public.is_household())', t);
    execute format('create policy "household delete" on public.%I for delete to authenticated using (public.is_household())', t);
  end loop;
end $$;

-- Add your household (edit these, then run):
-- insert into public.household (email) values ('you@example.com'), ('partner@example.com');
