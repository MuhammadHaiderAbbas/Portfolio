-- =====================================================================
--  AI writer: trending topics, article drafts and run history.
--  Run after schema.sql and dashboard.sql. Safe to run again.
--
--  The writer runs in GitHub Actions. It never gets a Supabase secret
--  key: it calls the agent_* functions below with a long random token
--  that is stored in Supabase Vault as "agent_token" and in GitHub as
--  the AGENT_TOKEN secret. Articles are always saved as drafts.
-- =====================================================================

-- Extra fields for search engines on blog posts
alter table public.posts add column if not exists seo_title        text    not null default '';
alter table public.posts add column if not exists meta_description text    not null default '';
alter table public.posts add column if not exists keywords         text[]  not null default '{}';
alter table public.posts add column if not exists sources          jsonb   not null default '[]';
alter table public.posts add column if not exists ai_generated     boolean not null default false;

-- ---------------------------------------------------------------------
-- Trending topics found by the writer
-- ---------------------------------------------------------------------
create table if not exists public.trend_topics (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source     text not null check (source in ('google', 'hackernews', 'devto', 'github', 'security', 'manual')),
  keyword    text not null check (char_length(keyword) between 1 and 160),
  title      text not null default '' check (char_length(title) <= 300),
  url        text not null default '' check (char_length(url) <= 600),
  context    text not null default '' check (char_length(context) <= 2000),
  score      numeric not null default 0,
  relevance  int not null default 0 check (relevance between 0 and 100),
  angle      text not null default '' check (char_length(angle) <= 500),
  status     text not null default 'new' check (status in ('new', 'queued', 'writing', 'written', 'skipped')),
  post_id    uuid references public.posts (id) on delete set null,
  unique (source, keyword)
);
create index if not exists trend_topics_rank_idx on public.trend_topics (status, relevance desc, created_at desc);
alter table public.trend_topics enable row level security;
drop policy if exists "admins manage topics" on public.trend_topics;
create policy "admins manage topics" on public.trend_topics
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.trend_topics to authenticated;
drop trigger if exists touch_updated_at on public.trend_topics;
create trigger touch_updated_at before update on public.trend_topics
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- History of writer runs
-- ---------------------------------------------------------------------
create table if not exists public.agent_runs (
  id           bigint generated always as identity primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  mode         text not null default 'auto',
  status       text not null default 'running' check (status in ('running', 'ok', 'failed')),
  topics_found int not null default 0,
  articles     int not null default 0,
  summary      text not null default '' check (char_length(summary) <= 2000),
  run_url      text not null default ''
);
alter table public.agent_runs enable row level security;
drop policy if exists "admins read runs" on public.agent_runs;
create policy "admins read runs" on public.agent_runs
  for select to authenticated using (public.is_admin());
grant select on public.agent_runs to authenticated;

-- ---------------------------------------------------------------------
-- Token check used by every agent_* function
-- ---------------------------------------------------------------------
create or replace function public.agent_ok(p_token text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'agent_token';
  return v is not null and char_length(v) >= 32 and p_token is not null and p_token = v;
end $$;
revoke all on function public.agent_ok(text) from public, anon, authenticated;

-- Everything the writer needs to know, in one call.
create or replace function public.agent_context(p_token text)
returns json language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.agent_ok(p_token) then raise exception 'Invalid agent token'; end if;
  return json_build_object(
    'profile', (select json_build_object('name', name, 'headline', headline, 'intro', intro, 'about', about, 'location', location) from public.profile where id = 1),
    'settings', (select coalesce(json_object_agg(key, value), '{}') from public.site_text where key like 'ai.%'),
    'posts', (select coalesce(json_agg(json_build_object('slug', slug, 'title', title, 'tags', tags) order by published_on desc), '[]') from public.posts),
    'projects', (select coalesce(json_agg(json_build_object('slug', slug, 'title', title, 'category', category, 'summary', summary)), '[]') from public.projects where published),
    'services', (select coalesce(json_agg(json_build_object('slug', slug, 'title', title, 'tagline', tagline)), '[]') from public.services where published and slug is not null),
    'queued', (select coalesce(json_agg(t order by t.updated_at), '[]') from (select id, source, keyword, title, url, context, angle, updated_at from public.trend_topics where status = 'queued') t),
    'candidates', (select coalesce(json_agg(t), '[]') from (
        select id, source, keyword, title, url, context, angle, relevance from public.trend_topics
         where status = 'new' and created_at > now() - interval '10 days'
         order by relevance desc, score desc limit 20) t),
    'recent_keywords', (select coalesce(json_agg(keyword), '[]') from public.trend_topics where created_at > now() - interval '45 days')
  );
end $$;
revoke all on function public.agent_context(text) from public;
grant execute on function public.agent_context(text) to anon, authenticated;

-- Save scored topics (new ones are added, known ones refreshed while still new).
create or replace function public.agent_save_topics(p_token text, p_topics jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.agent_ok(p_token) then raise exception 'Invalid agent token'; end if;
  insert into public.trend_topics (source, keyword, title, url, context, score, relevance, angle)
  select x.source, left(x.keyword, 160), left(coalesce(x.title, ''), 300), left(coalesce(x.url, ''), 600),
         left(coalesce(x.context, ''), 2000), coalesce(x.score, 0), greatest(0, least(100, coalesce(x.relevance, 0))), left(coalesce(x.angle, ''), 500)
    from jsonb_to_recordset(p_topics) as x(source text, keyword text, title text, url text, context text, score numeric, relevance int, angle text)
   where x.source in ('google', 'hackernews', 'devto', 'github', 'security') and coalesce(x.keyword, '') <> ''
  on conflict (source, keyword) do update
     set title = excluded.title, url = excluded.url, context = excluded.context, score = excluded.score,
         relevance = excluded.relevance, angle = excluded.angle
   where public.trend_topics.status = 'new';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.agent_save_topics(text, jsonb) from public;
grant execute on function public.agent_save_topics(text, jsonb) to anon, authenticated;

-- Mark a topic as being written (so two runs never write the same one).
create or replace function public.agent_claim_topic(p_token text, p_topic_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.agent_ok(p_token) then raise exception 'Invalid agent token'; end if;
  update public.trend_topics set status = 'writing' where id = p_topic_id and status in ('new', 'queued');
  return found;
end $$;
revoke all on function public.agent_claim_topic(text, bigint) from public;
grant execute on function public.agent_claim_topic(text, bigint) to anon, authenticated;

-- Save an article as a DRAFT and tell the admin.
create or replace function public.agent_save_post(p_token text, p_topic_id bigint, p_post jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_slug text := left(regexp_replace(lower(coalesce(p_post->>'slug', '')), '[^a-z0-9]+', '-', 'g'), 80);
  v_id uuid;
  v_title text := left(coalesce(p_post->>'title', ''), 200);
begin
  if not public.agent_ok(p_token) then raise exception 'Invalid agent token'; end if;
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' or v_title = '' or coalesce(p_post->>'body', '') = '' then raise exception 'Article is missing a title, slug or body'; end if;
  if exists (select 1 from public.posts where slug = v_slug) then
    v_slug := left(v_slug, 70) || '-' || to_char(now(), 'YYMMDD');
  end if;
  insert into public.posts (slug, title, excerpt, tags, body, published, published_on, seo_title, meta_description, keywords, sources, ai_generated)
  values (
    v_slug, v_title,
    left(coalesce(p_post->>'excerpt', ''), 400),
    coalesce((select array_agg(left(x, 40)) from jsonb_array_elements_text(coalesce(p_post->'tags', '[]')) x), '{}'),
    left(p_post->>'body', 60000),
    false, current_date,
    left(coalesce(p_post->>'seo_title', ''), 80),
    left(coalesce(p_post->>'meta_description', ''), 200),
    coalesce((select array_agg(left(x, 60)) from jsonb_array_elements_text(coalesce(p_post->'keywords', '[]')) x), '{}'),
    coalesce(p_post->'sources', '[]'),
    true
  ) returning id into v_id;
  if p_topic_id is not null then
    update public.trend_topics set status = 'written', post_id = v_id where id = p_topic_id;
  end if;
  perform public.notify('content', 'success', 'New article draft: ' || v_title,
    'Written from a trending topic. Read it, edit if needed, then approve it on the AI writer page.', '#writer');
  return json_build_object('id', v_id, 'slug', v_slug);
end $$;
revoke all on function public.agent_save_post(text, bigint, jsonb) from public;
grant execute on function public.agent_save_post(text, bigint, jsonb) to anon, authenticated;

-- Put a topic back if writing failed.
create or replace function public.agent_release_topic(p_token text, p_topic_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.agent_ok(p_token) then raise exception 'Invalid agent token'; end if;
  update public.trend_topics set status = 'queued' where id = p_topic_id and status = 'writing';
end $$;
revoke all on function public.agent_release_topic(text, bigint) from public;
grant execute on function public.agent_release_topic(text, bigint) to anon, authenticated;

-- Start / finish a run record. A failed run raises a notification.
create or replace function public.agent_log(p_token text, p_run_id bigint, p_mode text, p_status text,
  p_topics int default 0, p_articles int default 0, p_summary text default '', p_run_url text default '')
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint := p_run_id;
begin
  if not public.agent_ok(p_token) then raise exception 'Invalid agent token'; end if;
  if v_id is null then
    insert into public.agent_runs (mode, status, run_url) values (left(coalesce(p_mode, 'auto'), 40), 'running', left(coalesce(p_run_url, ''), 300))
    returning id into v_id;
    return v_id;
  end if;
  update public.agent_runs
     set status = case when p_status in ('ok', 'failed') then p_status else 'ok' end,
         finished_at = now(), topics_found = coalesce(p_topics, 0), articles = coalesce(p_articles, 0),
         summary = left(coalesce(p_summary, ''), 2000)
   where id = v_id;
  if p_status = 'failed' then
    perform public.notify('health', 'error', 'The AI writer could not finish', left(coalesce(p_summary, ''), 600), '#writer');
  end if;
  delete from public.agent_runs where started_at < now() - interval '120 days';
  return v_id;
end $$;
revoke all on function public.agent_log(text, bigint, text, text, int, int, text, text) from public;
grant execute on function public.agent_log(text, bigint, text, text, int, int, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Admin buttons: ask GitHub to run the writer now
-- ---------------------------------------------------------------------
create or replace function public.run_writer(p_mode text default 'write')
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
  v_repo  text;
  v_id    bigint;
begin
  if not public.is_admin() then raise exception 'Only admins can run the writer'; end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'github_token';
  select decrypted_secret into v_repo  from vault.decrypted_secrets where name = 'github_repo';
  if v_token is null or v_repo is null then
    raise exception 'Publishing is not set up: add the github_token and github_repo secrets (see README, step 5)';
  end if;
  select net.http_post(
    url     := 'https://api.github.com/repos/' || v_repo || '/dispatches',
    body    := jsonb_build_object('event_type', 'ai-writer', 'client_payload', jsonb_build_object('mode', case when p_mode = 'trends' then 'trends' else 'write' end)),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'portfolio-admin',
      'Content-Type', 'application/json')
  ) into v_id;
  return json_build_object('request_id', v_id);
end $$;
revoke all on function public.run_writer(text) from public, anon;
grant execute on function public.run_writer(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'agent_runs') then
    alter publication supabase_realtime add table public.agent_runs;
  end if;
end $$;
