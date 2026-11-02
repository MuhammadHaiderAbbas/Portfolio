-- =====================================================================
--  Dashboard: visit statistics, notifications and job opportunities.
--  Run after schema.sql (Dashboard → SQL Editor → New query → Run).
--  Safe to run again.
--
--  Privacy: visits store no IP address, no cookie and no exact location.
--  The visitor's device time zone (e.g. Europe/London) is the only
--  location signal; the admin panel turns it into an approximate area.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Notifications for the admin bell
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind       text not null default 'info'
             check (kind in ('message','opportunity','publish','deploy','content','health','info')),
  level      text not null default 'info' check (level in ('info','success','warning','error')),
  title      text not null check (char_length(title) between 1 and 200),
  body       text not null default '' check (char_length(body) <= 1000),
  link       text not null default '' check (char_length(link) <= 300),
  dedupe_key text unique check (char_length(dedupe_key) <= 200),
  is_read    boolean not null default false
);
create index if not exists notifications_created_idx on public.notifications (created_at desc);
alter table public.notifications enable row level security;
drop policy if exists "admins manage notifications" on public.notifications;
create policy "admins manage notifications" on public.notifications
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.notifications to authenticated;

-- Internal helper used by the triggers below.
create or replace function public.notify(
  p_kind text, p_level text, p_title text, p_body text default '', p_link text default '', p_key text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (kind, level, title, body, link, dedupe_key)
  values (p_kind, p_level, left(p_title, 200), left(coalesce(p_body, ''), 1000), left(coalesce(p_link, ''), 300), p_key)
  on conflict (dedupe_key) do nothing;
  -- Keep the list tidy: drop read notifications older than 90 days.
  if random() < 0.02 then
    delete from public.notifications where is_read and created_at < now() - interval '90 days';
  end if;
end $$;

-- New contact message
create or replace function public.notify_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify('message', 'info', 'New message from ' || new.name,
    coalesce(nullif(new.subject, ''), left(new.body, 160)), '#messages');
  return null;
end $$;
drop trigger if exists notify_message on public.messages;
create trigger notify_message after insert on public.messages
  for each row execute function public.notify_message();

-- Content edits: one notification per section, merged while unread for 30 minutes.
create or replace function public.mark_content_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_label text := case tg_table_name
    when 'posts' then 'Blog posts' when 'timeline' then 'Experience & education'
    when 'stats' then 'Snapshot numbers' when 'focus_areas' then 'What I do'
    when 'site_text' then 'Site text & settings'
    else initcap(replace(tg_table_name, '_', ' ')) end;
  v_what  text := case tg_op when 'INSERT' then 'added' when 'DELETE' then 'removed' else 'edited' end;
begin
  update public.site_state set content_changed_at = now() where id = 1;
  update public.notifications
     set created_at = now(),
         body = left(v_label || ': ' || v_what || '. Publish to put the change live.', 1000)
   where kind = 'content' and link = '#' || tg_table_name and not is_read
     and created_at > now() - interval '30 minutes';
  if not found then
    perform public.notify('content', 'info', v_label || ' updated',
      v_label || ': ' || v_what || '. Publish to put the change live.', '#' || tg_table_name);
  end if;
  return null;
end $$;

-- Publish pressed
create or replace function public.notify_publish()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.last_published_at is distinct from old.last_published_at then
    perform public.notify('publish', 'info', 'Publishing started',
      'GitHub is rebuilding the site. It is usually live in about a minute.', '#dashboard');
  end if;
  return null;
end $$;
drop trigger if exists notify_publish on public.site_state;
create trigger notify_publish after update on public.site_state
  for each row execute function public.notify_publish();

-- ---------------------------------------------------------------------
-- Job opportunities sent by companies from the "Hire me" page
-- ---------------------------------------------------------------------
create table if not exists public.opportunities (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  company      text not null check (char_length(company) between 1 and 120),
  contact_name text not null check (char_length(contact_name) between 1 and 120),
  email        text not null check (char_length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone        text not null default '' check (char_length(phone) <= 40),
  role_title   text not null check (char_length(role_title) between 1 and 150),
  job_type     text not null default 'full-time'
               check (job_type in ('full-time','part-time','contract','freelance','internship','other')),
  work_mode    text not null default 'hybrid' check (work_mode in ('remote','hybrid','on-site')),
  location     text not null default '' check (char_length(location) <= 120),
  salary       text not null default '' check (char_length(salary) <= 80),
  job_url      text not null default '' check (char_length(job_url) <= 500 and (job_url = '' or job_url ~* '^https?://')),
  message      text not null default '' check (char_length(message) <= 5000),
  status       text not null default 'new'
               check (status in ('new','reviewing','interview','offer','declined','closed')),
  notes        text not null default '' check (char_length(notes) <= 10000)
);
create index if not exists opportunities_created_idx on public.opportunities (created_at desc);
alter table public.opportunities enable row level security;
drop policy if exists "companies send opportunities" on public.opportunities;
create policy "companies send opportunities" on public.opportunities
  for insert to anon, authenticated with check (status = 'new' and notes = '');
drop policy if exists "admins manage opportunities" on public.opportunities;
create policy "admins manage opportunities" on public.opportunities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant insert on public.opportunities to anon, authenticated;
grant select, update, delete on public.opportunities to authenticated;

create or replace function public.limit_opportunity_rate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.opportunities where created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many requests right now. Please try again later or send an email.';
  end if;
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists limit_opportunity_rate on public.opportunities;
create trigger limit_opportunity_rate before insert on public.opportunities
  for each row execute function public.limit_opportunity_rate();
drop trigger if exists touch_updated_at on public.opportunities;
create trigger touch_updated_at before update on public.opportunities
  for each row execute function public.touch_updated_at();

create or replace function public.notify_opportunity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify('opportunity', 'success', new.company || ' wants to hire you',
    new.role_title || ' · ' || new.job_type || ' · ' || new.work_mode
      || case when new.location <> '' then ' · ' || new.location else '' end,
    '#opportunities');
  return null;
end $$;
drop trigger if exists notify_opportunity on public.opportunities;
create trigger notify_opportunity after insert on public.opportunities
  for each row execute function public.notify_opportunity();

-- ---------------------------------------------------------------------
-- Page views (anonymous, cookie-free)
-- ---------------------------------------------------------------------
create table if not exists public.page_views (
  id         uuid primary key,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  session_id text not null check (char_length(session_id) between 8 and 40),
  path       text not null check (char_length(path) between 1 and 300),
  title      text not null default '' check (char_length(title) <= 200),
  referrer   text not null default '' check (char_length(referrer) <= 200),
  timezone   text not null default '' check (char_length(timezone) <= 64),
  device     text not null default '' check (device in ('', 'mobile', 'tablet', 'desktop')),
  browser    text not null default '' check (char_length(browser) <= 40),
  os         text not null default '' check (char_length(os) <= 40),
  language   text not null default '' check (char_length(language) <= 20),
  screen     text not null default '' check (char_length(screen) <= 20),
  duration_s int  not null default 0 check (duration_s between 0 and 14400)
);
create index if not exists page_views_created_idx on public.page_views (created_at desc);
create index if not exists page_views_last_seen_idx on public.page_views (last_seen desc);
alter table public.page_views enable row level security;
drop policy if exists "visitors record views" on public.page_views;
create policy "visitors record views" on public.page_views
  for insert to anon, authenticated with check (true);
drop policy if exists "admins read views" on public.page_views;
create policy "admins read views" on public.page_views
  for select to authenticated using (public.is_admin());
drop policy if exists "admins delete views" on public.page_views;
create policy "admins delete views" on public.page_views
  for delete to authenticated using (public.is_admin());
grant insert on public.page_views to anon, authenticated;
grant select, delete on public.page_views to authenticated;

-- Server sets the times; a flood of fake views is quietly dropped;
-- views older than 13 months are cleared now and then.
create or replace function public.guard_page_view()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.page_views where created_at > now() - interval '1 hour') >= 5000 then
    return null;
  end if;
  new.created_at := now();
  new.last_seen := now();
  new.duration_s := 0;
  if random() < 0.001 then
    delete from public.page_views where created_at < now() - interval '13 months';
  end if;
  return new;
end $$;
drop trigger if exists guard_page_view on public.page_views;
create trigger guard_page_view before insert on public.page_views
  for each row execute function public.guard_page_view();

-- Heartbeat from an open page: keeps "now watching" and time on page right.
create or replace function public.view_ping(p_id uuid, p_seconds int)
returns void language sql security definer set search_path = '' as $$
  update public.page_views
     set last_seen = now(),
         duration_s = greatest(duration_s, least(coalesce(p_seconds, 0), 14400,
                        extract(epoch from now() - created_at)::int + 5))
   where id = p_id and created_at > now() - interval '4 hours';
$$;
revoke all on function public.view_ping(uuid, int) from public;
grant execute on function public.view_ping(uuid, int) to anon, authenticated;

-- Everything the dashboard charts need for the last p_days days, in one call.
create or replace function public.dashboard_stats(p_days int default 7)
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_days  int := greatest(1, least(coalesce(p_days, 7), 365));
  v_from  timestamptz := now() - make_interval(days => v_days);
  v_prev  timestamptz := now() - make_interval(days => v_days * 2);
  v_hourly boolean := v_days = 1;
  v_out json;
begin
  if not public.is_admin() then
    raise exception 'Only admins can read statistics';
  end if;

  with v as (select * from public.page_views where created_at >= v_from),
       p as (select * from public.page_views where created_at >= v_prev and created_at < v_from),
       buckets as (
         select b from generate_series(
           case when v_hourly then date_trunc('hour', now()) - interval '23 hours'
                else date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London'
                     - make_interval(days => v_days - 1) end,
           now(),
           case when v_hourly then interval '1 hour' else interval '1 day' end) b),
       series as (
         select bk.b,
                count(v.id) as views,
                count(distinct v.session_id) as visitors
           from buckets bk
           left join v on v.created_at >= bk.b
                      and v.created_at < bk.b + case when v_hourly then interval '1 hour' else interval '1 day' end
          group by bk.b order by bk.b)
  select json_build_object(
    'days', v_days,
    'hourly', v_hourly,
    'totals', (select json_build_object(
        'views', count(*),
        'visitors', count(distinct session_id),
        'avg_seconds', coalesce(round(avg(duration_s) filter (where duration_s > 0)), 0),
        'bounce', coalesce(round(100.0 * (select count(*) from (select session_id from v group by session_id having count(*) = 1) s)
                   / nullif(count(distinct session_id), 0)), 0)) from v),
    'previous', (select json_build_object(
        'views', count(*),
        'visitors', count(distinct session_id),
        'avg_seconds', coalesce(round(avg(duration_s) filter (where duration_s > 0)), 0)) from p),
    'series', (select coalesce(json_agg(json_build_object('t', b, 'views', views, 'visitors', visitors)), '[]') from series),
    'pages', (select coalesce(json_agg(x), '[]') from (
        select path, max(title) as title, count(*) as views, count(distinct session_id) as visitors,
               coalesce(round(avg(duration_s) filter (where duration_s > 0)), 0) as avg_seconds
          from v group by path order by count(*) desc limit 12) x),
    'referrers', (select coalesce(json_agg(x), '[]') from (
        select coalesce(nullif(referrer, ''), 'Direct') as name, count(distinct session_id) as n
          from v group by 1 order by 2 desc limit 10) x),
    'devices', (select coalesce(json_agg(x), '[]') from (
        select coalesce(nullif(device, ''), 'unknown') as name, count(distinct session_id) as n
          from v group by 1 order by 2 desc) x),
    'browsers', (select coalesce(json_agg(x), '[]') from (
        select coalesce(nullif(browser, ''), 'Other') as name, count(distinct session_id) as n
          from v group by 1 order by 2 desc limit 8) x),
    'systems', (select coalesce(json_agg(x), '[]') from (
        select coalesce(nullif(os, ''), 'Other') as name, count(distinct session_id) as n
          from v group by 1 order by 2 desc limit 8) x),
    'languages', (select coalesce(json_agg(x), '[]') from (
        select coalesce(nullif(language, ''), 'unknown') as name, count(distinct session_id) as n
          from v group by 1 order by 2 desc limit 8) x),
    'zones', (select coalesce(json_agg(x), '[]') from (
        select timezone as name, count(distinct session_id) as n, count(*) as views
          from v where timezone <> '' group by 1 order by 2 desc limit 200) x)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.dashboard_stats(int) from public, anon;
grant execute on function public.dashboard_stats(int) to authenticated;

-- Who is on the site right now, plus the latest visits, for the live panel.
create or replace function public.dashboard_live()
returns json language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can read statistics';
  end if;
  return json_build_object(
    'now', now(),
    'watching', (select coalesce(json_agg(x), '[]') from (
        select distinct on (session_id) session_id, path, title, timezone, device, browser, os, referrer,
               created_at, last_seen
          from public.page_views
         where last_seen > now() - interval '45 seconds'
         order by session_id, last_seen desc) x),
    'today', (select json_build_object('views', count(*), 'visitors', count(distinct session_id))
                from public.page_views
               where created_at >= date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London'),
    'recent', (select coalesce(json_agg(x), '[]') from (
        select id, path, title, timezone, device, browser, os, referrer, created_at, duration_s
          from public.page_views order by created_at desc limit 25) x)
  );
end $$;
revoke all on function public.dashboard_live() from public, anon;
grant execute on function public.dashboard_live() to authenticated;

-- Trigger-only and internal functions are not callable through the API.
revoke all on function public.notify(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.notify_message() from public, anon, authenticated;
revoke all on function public.notify_publish() from public, anon, authenticated;
revoke all on function public.notify_opportunity() from public, anon, authenticated;
revoke all on function public.limit_opportunity_rate() from public, anon, authenticated;
revoke all on function public.guard_page_view() from public, anon, authenticated;
revoke all on function public.mark_content_changed() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Live updates in the admin panel
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['notifications','messages','opportunities','page_views'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
