-- =====================================================================
--  Portfolio database: tables, security rules, media storage, publish
--  Run this once in Supabase: Dashboard → SQL Editor → New query → Run.
--  It is safe to run again; it only creates what is missing.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- Admins: only users listed here can change content
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- No policies on admins: nobody can read or edit it through the API.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- One row that records when content last changed and when the site was
-- last published, so the admin panel can show "unpublished changes".
create table if not exists public.site_state (
  id                 int primary key default 1 check (id = 1),
  content_changed_at timestamptz not null default now(),
  last_published_at  timestamptz,
  last_request_id    bigint
);
insert into public.site_state (id) values (1) on conflict do nothing;
alter table public.site_state enable row level security;
drop policy if exists "admins read site state" on public.site_state;
create policy "admins read site state" on public.site_state
  for select to authenticated using (public.is_admin());

create or replace function public.mark_content_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.site_state set content_changed_at = now() where id = 1;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- Content tables
-- ---------------------------------------------------------------------
create table if not exists public.profile (
  id              int primary key default 1 check (id = 1),
  name            text not null default '',
  short_name      text not null default '',
  headline        text not null default '',
  intro           text not null default '',
  about           text not null default '',
  availability    text not null default '',
  location        text not null default '',
  email           text not null default '',
  phone           text not null default '',
  photo_url       text not null default '',
  cv_url          text not null default '',
  roles           text[] not null default '{}',
  disciplines     jsonb not null default '[]'::jsonb,
  socials         jsonb not null default '[]'::jsonb,
  seo_description text not null default '',
  updated_at      timestamptz not null default now()
);

create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title        text not null,
  summary      text not null default '',
  category     text not null default '',
  tech         text[] not null default '{}',
  cover_url    text not null default '',
  gallery      text[] not null default '{}',
  body         text not null default '',
  live_url     text not null default '',
  repo_url     text not null default '',
  video_url    text not null default '',
  document_url text not null default '',
  status       text not null default '',
  role         text not null default '',
  year         text not null default '',
  featured     boolean not null default false,
  published    boolean not null default false,
  sort_order   int not null default 100,
  project_date date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title        text not null,
  excerpt      text not null default '',
  cover_url    text not null default '',
  tags         text[] not null default '{}',
  body         text not null default '',
  published    boolean not null default false,
  published_on date not null default current_date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.certifications (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  issuer         text not null default '',
  issued_label   text not null default '',
  summary        text not null default '',
  details        text not null default '',
  credential_url text not null default '',
  image_url      text not null default '',
  sort_order     int not null default 100,
  published      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.timeline (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null default 'work' check (kind in ('work', 'education')),
  title        text not null,
  organisation text not null default '',
  period       text not null default '',
  description  text not null default '',
  sort_order   int not null default 100,
  published    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.skills (
  id         uuid primary key default gen_random_uuid(),
  group_name text not null default 'Other',
  name       text not null,
  level      int check (level between 0 and 100),
  sort_order int not null default 100,
  published  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id               uuid primary key default gen_random_uuid(),
  slug             text unique check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title            text not null,
  icon             text not null default '',
  tagline          text not null default '',
  description      text not null default '',
  body             text not null default '',
  price_label      text not null default '',
  price_note       text not null default '',
  features         text[] not null default '{}',
  tools            text[] not null default '{}',
  process          text[] not null default '{}',
  delivery_time    text not null default '',
  related_category text not null default '',
  highlighted      boolean not null default false,
  sort_order  int not null default 100,
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Homepage snapshot numbers, e.g. "10+ core projects"
create table if not exists public.stats (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  value      text not null default '',
  icon       text not null default '',
  sort_order int not null default 100,
  published  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Homepage "What I do" blocks
create table if not exists public.focus_areas (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text not null default '',
  icon        text not null default '',
  sort_order  int not null default 100,
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Every label, heading and setting on the site (Admin → Site text & settings).
-- Keys without a row use the default wording built into the site.
create table if not exists public.site_text (
  key        text primary key check (key ~ '^[a-z0-9_.]+$' and char_length(key) <= 80),
  value      text not null default '' check (char_length(value) <= 2000),
  updated_at timestamptz not null default now()
);

-- Security rules for content: everyone can read published rows,
-- only admins can see drafts or change anything.
do $$
declare t text;
begin
  foreach t in array array['projects','posts','certifications','timeline','skills','services','stats','focus_areas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "public reads published" on public.%I', t);
    execute format('create policy "public reads published" on public.%I for select to anon, authenticated using (published or public.is_admin())', t);
    execute format('drop policy if exists "admins write" on public.%I', t);
    execute format('create policy "admins write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;

  foreach t in array array['profile','projects','posts','certifications','timeline','skills','services','stats','focus_areas','site_text'] loop
    execute format('drop trigger if exists touch_updated_at on public.%I', t);
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', t);
    execute format('drop trigger if exists mark_content_changed on public.%I', t);
    execute format('create trigger mark_content_changed after insert or update or delete on public.%I for each statement execute function public.mark_content_changed()', t);
  end loop;
end $$;

alter table public.profile enable row level security;
drop policy if exists "public reads profile" on public.profile;
create policy "public reads profile" on public.profile
  for select to anon, authenticated using (true);
drop policy if exists "admins update profile" on public.profile;
create policy "admins update profile" on public.profile
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.profile to anon, authenticated;
grant update on public.profile to authenticated;
insert into public.profile (id) values (1) on conflict do nothing;

alter table public.site_text enable row level security;
drop policy if exists "public reads site text" on public.site_text;
create policy "public reads site text" on public.site_text
  for select to anon, authenticated using (true);
drop policy if exists "admins write site text" on public.site_text;
create policy "admins write site text" on public.site_text
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.site_text to anon, authenticated;
grant insert, update, delete on public.site_text to authenticated;

-- ---------------------------------------------------------------------
-- Contact form messages: anyone can send, only admins can read
-- ---------------------------------------------------------------------
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  email      text not null check (char_length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  subject    text not null default '' check (char_length(subject) <= 200),
  body       text not null check (char_length(body) between 1 and 5000),
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
drop policy if exists "anyone sends messages" on public.messages;
create policy "anyone sends messages" on public.messages
  for insert to anon, authenticated with check (is_read = false);
drop policy if exists "admins manage messages" on public.messages;
create policy "admins manage messages" on public.messages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant insert on public.messages to anon, authenticated;
grant select, update, delete on public.messages to authenticated;

-- Flood guard: refuse new messages once 30 have arrived in the last hour.
create or replace function public.limit_message_rate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.messages where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many messages right now. Please try again later or send an email.';
  end if;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists limit_message_rate on public.messages;
create trigger limit_message_rate before insert on public.messages
  for each row execute function public.limit_message_rate();

-- ---------------------------------------------------------------------
-- Media storage for uploaded images and the CV
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 10485760,
        array['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'application/pdf',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

drop policy if exists "admins upload media" on storage.objects;
create policy "admins upload media" on storage.objects
  for insert to authenticated with check (bucket_id = 'media' and public.is_admin());
drop policy if exists "admins update media" on storage.objects;
create policy "admins update media" on storage.objects
  for update to authenticated using (bucket_id = 'media' and public.is_admin());
drop policy if exists "admins delete media" on storage.objects;
create policy "admins delete media" on storage.objects
  for delete to authenticated using (bucket_id = 'media' and public.is_admin());
drop policy if exists "admins list media" on storage.objects;
create policy "admins list media" on storage.objects
  for select to authenticated using (bucket_id = 'media' and public.is_admin());

-- ---------------------------------------------------------------------
-- Publish: asks GitHub to rebuild the site (about a minute).
-- Needs two Vault secrets, created in the setup step of the README:
--   github_token  a fine-grained token with Contents: read & write on the repo
--   github_repo   owner/repo, e.g. MuhammadHaiderAbbas/Portfolio
-- ---------------------------------------------------------------------
create or replace function public.publish_site()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_repo  text;
  v_id    bigint;
begin
  if not public.is_admin() then
    raise exception 'Only admins can publish';
  end if;

  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'github_token';
  select decrypted_secret into v_repo  from vault.decrypted_secrets where name = 'github_repo';
  if v_token is null or v_repo is null then
    raise exception 'Publishing is not set up: add the github_token and github_repo secrets (see README, step 5)';
  end if;

  select net.http_post(
    url     := 'https://api.github.com/repos/' || v_repo || '/dispatches',
    body    := jsonb_build_object('event_type', 'publish'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'portfolio-admin',
      'Content-Type', 'application/json'
    )
  ) into v_id;

  update public.site_state
     set last_published_at = now(), last_request_id = v_id
   where id = 1;

  return json_build_object('request_id', v_id);
end $$;
revoke all on function public.publish_site() from public, anon;
grant execute on function public.publish_site() to authenticated;

-- Reports GitHub's answer to a publish request (204 means accepted).
create or replace function public.publish_status(p_request_id bigint)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  if not public.is_admin() then
    raise exception 'Only admins can check publishing';
  end if;
  select status_code, error_msg, content into r from net._http_response where id = p_request_id;
  if not found then
    return json_build_object('state', 'pending');
  end if;
  return json_build_object(
    'state', case when r.status_code between 200 and 299 then 'accepted' else 'failed' end,
    'status_code', r.status_code,
    'error', coalesce(r.error_msg, left(r.content, 300))
  );
end $$;
revoke all on function public.publish_status(bigint) from public, anon;
grant execute on function public.publish_status(bigint) to authenticated;

-- Trigger-only functions should not be callable through the API.
revoke all on function public.mark_content_changed() from public, anon, authenticated;
revoke all on function public.limit_message_rate() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
