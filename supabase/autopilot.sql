-- =====================================================================
--  Autopilot: articles publish themselves 1 hour after the draft email
--  unless you hold them; email alerts for important events.
--  Run after writer.sql. Safe to run again.
--
--  Email is sent with Resend (free: 100 emails a day). Save your Resend
--  API key in Admin → Email alerts; it is stored in Supabase Vault.
-- =====================================================================

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------
-- Settings for email alerts (admins only)
-- ---------------------------------------------------------------------
create table if not exists public.alert_settings (
  id               int primary key default 1 check (id = 1),
  email            text not null default '' check (email = '' or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  enabled          boolean not null default true,
  on_articles      boolean not null default true,
  on_opportunities boolean not null default true,
  on_messages      boolean not null default true,
  on_problems      boolean not null default true,
  site_url         text not null default 'https://personalportfolio.website',
  updated_at       timestamptz not null default now()
);
insert into public.alert_settings (id) values (1) on conflict do nothing;
alter table public.alert_settings enable row level security;
drop policy if exists "admins manage alerts" on public.alert_settings;
create policy "admins manage alerts" on public.alert_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, update on public.alert_settings to authenticated;

create table if not exists public.email_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  subject    text not null,
  request_id bigint
);
alter table public.email_log enable row level security;
drop policy if exists "admins read email log" on public.email_log;
create policy "admins read email log" on public.email_log
  for select to authenticated using (public.is_admin());
grant select on public.email_log to authenticated;

-- ---------------------------------------------------------------------
-- Review state of each AI draft (admins only; the token is for email links)
-- ---------------------------------------------------------------------
create table if not exists public.draft_reviews (
  post_id         uuid primary key references public.posts (id) on delete cascade,
  created_at      timestamptz not null default now(),
  token           uuid not null default gen_random_uuid() unique,
  status          text not null default 'pending'
                  check (status in ('pending', 'needs_review', 'held', 'approved', 'auto_published')),
  auto_publish_at timestamptz,
  decided_at      timestamptz,
  safe            boolean,
  quality         int,
  notes           text not null default '',
  model           text not null default ''
);
create index if not exists draft_reviews_due_idx on public.draft_reviews (status, auto_publish_at);
alter table public.draft_reviews enable row level security;
drop policy if exists "admins manage reviews" on public.draft_reviews;
create policy "admins manage reviews" on public.draft_reviews
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, update, delete on public.draft_reviews to authenticated;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.html_escape(p text)
returns text language sql immutable set search_path = '' as $$
  select replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
$$;

create or replace function public.email_html(p_title text, p_body text, p_buttons jsonb default '[]', p_note text default '')
returns text language plpgsql stable set search_path = '' as $$
declare
  v_btns text := '';
  b jsonb;
  i int := 0;
begin
  for b in select * from jsonb_array_elements(coalesce(p_buttons, '[]')) loop
    v_btns := v_btns || format(
      '<a href="%s" style="display:inline-block;margin:0 8px 10px 0;padding:12px 20px;border-radius:999px;font-weight:bold;text-decoration:none;%s">%s</a>',
      public.html_escape(b->>'url'),
      case when i = 0 then 'background:#0067c9;color:#ffffff;' else 'background:#ffffff;color:#0b2540;border:2px solid #c9d6e6;' end,
      public.html_escape(b->>'label'));
    i := i + 1;
  end loop;
  return format(
    '<div style="background:#f2f5f9;padding:24px 12px;font-family:''Times New Roman'',Times,serif;color:#14181f">'
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dde3ea">'
    '<div style="background:#041633;background:linear-gradient(120deg,#041633,#0067c9);padding:18px 24px;color:#ffffff;font-size:15px;letter-spacing:2px;text-transform:uppercase">Your portfolio</div>'
    '<div style="padding:24px"><h1 style="margin:0 0 12px;font-size:24px;line-height:1.25">%s</h1>'
    '<p style="margin:0 0 20px;font-size:17px;line-height:1.6;color:#2b3442">%s</p>%s'
    '%s</div></div>'
    '<p style="max-width:560px;margin:14px auto 0;font-size:13px;color:#6b7686;text-align:center">Sent by your website. Change which emails you get in Admin → Email alerts.</p></div>',
    public.html_escape(p_title),
    replace(public.html_escape(p_body), E'\n', '<br>'),
    v_btns,
    case when coalesce(p_note, '') <> '' then '<p style="margin:16px 0 0;font-size:14px;color:#6b7686">' || public.html_escape(p_note) || '</p>' else '' end);
end $$;

-- Sends one email to the address in Admin → Email alerts. Quietly does nothing
-- until a Resend key and an address are saved. At most 40 emails an hour.
create or replace function public.send_email(p_subject text, p_html text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_key  text;
  v_from text;
  v_to   text;
  v_on   boolean;
  v_id   bigint;
begin
  select email, enabled into v_to, v_on from public.alert_settings where id = 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key';
  select decrypted_secret into v_from from vault.decrypted_secrets where name = 'alert_from';
  if v_key is null or coalesce(v_to, '') = '' or not coalesce(v_on, false) then return null; end if;
  if (select count(*) from public.email_log where created_at > now() - interval '1 hour') >= 40 then return null; end if;
  select net.http_post(
    url     := 'https://api.resend.com/emails',
    body    := jsonb_build_object('from', coalesce(nullif(v_from, ''), 'Portfolio alerts <onboarding@resend.dev>'), 'to', jsonb_build_array(v_to),
                                  'subject', left(p_subject, 180), 'html', p_html),
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json')
  ) into v_id;
  insert into public.email_log (subject, request_id) values (left(p_subject, 180), v_id);
  delete from public.email_log where created_at < now() - interval '30 days';
  return v_id;
end $$;

-- Tells GitHub to rebuild the site (same as the Publish button, without the admin check).
create or replace function public.dispatch_publish()
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
  v_repo  text;
  v_id    bigint;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'github_token';
  select decrypted_secret into v_repo  from vault.decrypted_secrets where name = 'github_repo';
  if v_token is null or v_repo is null then return null; end if;
  select net.http_post(
    url     := 'https://api.github.com/repos/' || v_repo || '/dispatches',
    body    := jsonb_build_object('event_type', 'publish'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Accept', 'application/vnd.github+json',
                                  'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'portfolio-autopilot', 'Content-Type', 'application/json')
  ) into v_id;
  update public.site_state set last_published_at = now(), last_request_id = v_id where id = 1;
  return v_id;
end $$;

-- Puts one draft live (used by the timer, the email link and the admin button).
create or replace function public.publish_draft(p_post_id uuid, p_how text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_post record;
  v_site text;
begin
  select id, slug, title, excerpt into v_post from public.posts where id = p_post_id;
  if not found then return json_build_object('status', 'missing'); end if;
  update public.posts set published = true, published_on = current_date where id = p_post_id;
  update public.draft_reviews
     set status = case when p_how = 'auto' then 'auto_published' else 'approved' end, decided_at = now(), auto_publish_at = null
   where post_id = p_post_id;
  select site_url into v_site from public.alert_settings where id = 1;
  perform public.notify('content', 'success',
    case when p_how = 'auto' then 'Article published automatically: ' else 'Article published: ' end || v_post.title,
    'It is live in about a minute at /blog/' || v_post.slug || '/',
    rtrim(coalesce(v_site, ''), '/') || '/blog/' || v_post.slug || '/', 'published:' || p_post_id);
  perform public.dispatch_publish();
  return json_build_object('status', 'published', 'slug', v_post.slug, 'title', v_post.title);
end $$;

-- ---------------------------------------------------------------------
-- Email for important notifications
-- ---------------------------------------------------------------------
create or replace function public.email_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_send boolean := false;
  v_url text;
  v_label text := 'Open the admin panel';
begin
  select * into s from public.alert_settings where id = 1;
  if not found or not s.enabled or s.email = '' then return null; end if;
  if coalesce(new.dedupe_key, '') like 'draft:%' then return null; end if; -- drafts send their own email
  v_send := case
    when new.kind = 'message' then s.on_messages
    when new.kind = 'opportunity' then s.on_opportunities
    when new.kind = 'content' and coalesce(new.dedupe_key, '') like 'published:%' then s.on_articles
    when new.kind in ('health', 'deploy') and new.level = 'error' then s.on_problems
    else false end;
  if not v_send then return null; end if;
  v_url := case
    when new.link ~ '^https?://' then new.link
    when new.link like '#/%' then rtrim(s.site_url, '/') || '/admin/' || new.link
    when new.link like '#%' then rtrim(s.site_url, '/') || '/admin/#/' || substr(new.link, 2)
    else rtrim(s.site_url, '/') || '/admin/' end;
  if new.kind = 'content' then v_label := 'Read the article'; end if;
  if new.kind = 'opportunity' then v_label := 'See the opportunity'; end if;
  if new.kind = 'message' then v_label := 'Read the message'; end if;
  perform public.send_email(new.title, public.email_html(new.title, new.body, jsonb_build_array(jsonb_build_object('label', v_label, 'url', v_url))));
  return null;
end $$;
drop trigger if exists email_notification on public.notifications;
create trigger email_notification after insert on public.notifications
  for each row execute function public.email_notification();

-- ---------------------------------------------------------------------
-- Saving a draft now also schedules it and emails you approve / hold links
-- ---------------------------------------------------------------------
create or replace function public.agent_save_post(p_token text, p_topic_id bigint, p_post jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_slug    text := left(regexp_replace(lower(coalesce(p_post->>'slug', '')), '[^a-z0-9]+', '-', 'g'), 80);
  v_id      uuid;
  v_title   text := left(coalesce(p_post->>'title', ''), 200);
  v_review  jsonb := coalesce(p_post->'review', '{}');
  v_safe    boolean := coalesce((v_review->>'safe')::boolean, false);
  v_quality int := coalesce((v_review->>'quality')::int, 0);
  v_minutes int;
  v_status  text;
  v_token   uuid;
  v_site    text;
  v_notes   text := left(coalesce(v_review->>'notes', ''), 2000);
begin
  if not public.agent_ok(p_token) then raise exception 'Invalid agent token'; end if;
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' or v_title = '' or coalesce(p_post->>'body', '') = '' then raise exception 'Article is missing a title, slug or body'; end if;
  if exists (select 1 from public.posts where slug = v_slug) then
    v_slug := left(v_slug, 70) || '-' || to_char(now(), 'YYMMDDHH24MI');
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

  -- Auto-publish only articles the safety editor passed with good quality
  select coalesce(nullif(regexp_replace(value, '\D', '', 'g'), '')::int, 60) into v_minutes from public.site_text where key = 'ai.autopublish';
  v_minutes := coalesce(v_minutes, 60);
  v_status := case when v_safe and v_quality >= 7 and v_minutes > 0 then 'pending' else 'needs_review' end;
  insert into public.draft_reviews (post_id, status, auto_publish_at, safe, quality, notes, model)
  values (v_id, v_status, case when v_status = 'pending' then now() + make_interval(mins => v_minutes) end,
          v_safe, v_quality, v_notes, left(coalesce(v_review->>'model', ''), 80))
  returning token into v_token;

  perform public.notify('content', 'success',
    case when v_status = 'pending' then 'New article, publishing in ' || v_minutes || ' min: ' else 'New article needs your review: ' end || v_title,
    case when v_status = 'pending' then 'It goes live automatically unless you hold it.' else 'The safety editor flagged it, so it will not publish on its own. ' || v_notes end,
    '#writer', 'draft:' || v_id);

  select rtrim(site_url, '/') into v_site from public.alert_settings where id = 1;
  if (select on_articles from public.alert_settings where id = 1) then
    perform public.send_email(
      case when v_status = 'pending' then 'Publishing in ' || v_minutes || ' min: ' else 'Needs your review: ' end || v_title,
      public.email_html(
        v_title,
        coalesce(p_post->>'meta_description', p_post->>'excerpt', '') || E'\n\n' ||
        case when v_status = 'pending'
             then 'This article goes live automatically in ' || v_minutes || ' minutes unless you hold it. Quality score ' || v_quality || '/10.'
             else 'The safety editor flagged this draft, so it stays hidden until you approve it. Notes: ' || v_notes end,
        jsonb_build_array(
          jsonb_build_object('label', 'Publish now', 'url', v_site || '/review/?t=' || v_token || '&a=approve'),
          jsonb_build_object('label', 'Hold, do not publish', 'url', v_site || '/review/?t=' || v_token || '&a=hold'),
          jsonb_build_object('label', 'Read and edit', 'url', v_site || '/admin/#/posts/' || v_id)),
        'Written by ' || coalesce(nullif(v_review->>'model', ''), 'the AI writer') || ' from a trending topic.'));
  end if;
  return json_build_object('id', v_id, 'slug', v_slug, 'status', v_status);
end $$;
revoke all on function public.agent_save_post(text, bigint, jsonb) from public;
grant execute on function public.agent_save_post(text, bigint, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- The one-click links in the email (no sign-in; the token is secret)
-- ---------------------------------------------------------------------
create or replace function public.review_draft(p_token uuid, p_action text default 'status')
returns json language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_title text;
  v_slug text;
begin
  select d.*, p.title, p.slug, p.published into r
    from public.draft_reviews d join public.posts p on p.id = d.post_id
   where d.token = p_token and d.created_at > now() - interval '14 days';
  if not found then return json_build_object('status', 'invalid'); end if;
  v_title := r.title;
  v_slug := r.slug;
  if p_action = 'hold' and r.status in ('pending', 'needs_review') then
    update public.draft_reviews set status = 'held', auto_publish_at = null, decided_at = now() where post_id = r.post_id;
    perform public.notify('info', 'info', 'Article on hold: ' || v_title, 'You held it from the email. Publish it any time from the AI writer page.', '#writer');
    return json_build_object('status', 'held', 'title', v_title);
  elsif p_action = 'approve' and r.status in ('pending', 'needs_review', 'held') and not r.published then
    perform public.publish_draft(r.post_id, 'email');
    return json_build_object('status', 'published', 'title', v_title, 'slug', v_slug);
  end if;
  return json_build_object('status', case when r.published then 'published' else r.status end, 'title', v_title, 'slug', v_slug,
                           'auto_publish_at', r.auto_publish_at);
end $$;
revoke all on function public.review_draft(uuid, text) from public;
grant execute on function public.review_draft(uuid, text) to anon, authenticated;

-- Admin buttons on the AI writer page
create or replace function public.decide_draft(p_post_id uuid, p_action text)
returns json language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can review drafts'; end if;
  if p_action = 'approve' then
    return public.publish_draft(p_post_id, 'admin');
  elsif p_action = 'hold' then
    update public.draft_reviews set status = 'held', auto_publish_at = null, decided_at = now() where post_id = p_post_id;
    return json_build_object('status', 'held');
  end if;
  raise exception 'Unknown action';
end $$;
revoke all on function public.decide_draft(uuid, text) from public, anon;
grant execute on function public.decide_draft(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- The timer: every 5 minutes, publish drafts whose hour is up.
-- At most 3 automatic publishes in any 24 hours, as a safety limit.
-- ---------------------------------------------------------------------
create or replace function public.publish_due_drafts()
returns int language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
  v_recent int;
begin
  select count(*) into v_recent from public.draft_reviews where status = 'auto_published' and decided_at > now() - interval '24 hours';
  for r in select d.post_id from public.draft_reviews d join public.posts p on p.id = d.post_id
            where d.status = 'pending' and d.auto_publish_at <= now() and not p.published
            order by d.auto_publish_at limit 3 loop
    exit when v_recent + n >= 3;
    perform public.publish_draft(r.post_id, 'auto');
    n := n + 1;
  end loop;
  return n;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'publish-due-drafts';
    perform cron.schedule('publish-due-drafts', '*/5 * * * *', 'select public.publish_due_drafts()');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Admin: save secrets from the panel, send a test email
-- ---------------------------------------------------------------------
create or replace function public.set_secret(p_name text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Only admins can save secrets'; end if;
  if p_name not in ('resend_api_key', 'alert_from', 'agent_token') then raise exception 'Unknown secret'; end if;
  if p_name = 'agent_token' and char_length(coalesce(p_value, '')) < 32 then raise exception 'The token must be at least 32 characters'; end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_name);
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end $$;
revoke all on function public.set_secret(text, text) from public, anon;
grant execute on function public.set_secret(text, text) to authenticated;

create or replace function public.secret_status()
returns json language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins'; end if;
  return json_build_object(
    'resend_api_key', exists (select 1 from vault.secrets where name = 'resend_api_key'),
    'alert_from', (select decrypted_secret from vault.decrypted_secrets where name = 'alert_from'),
    'agent_token', exists (select 1 from vault.secrets where name = 'agent_token'),
    'github_token', exists (select 1 from vault.secrets where name = 'github_token'));
end $$;
revoke all on function public.secret_status() from public, anon;
grant execute on function public.secret_status() to authenticated;

create or replace function public.send_test_email()
returns json language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not public.is_admin() then raise exception 'Only admins'; end if;
  v_id := public.send_email('Test email from your portfolio',
    public.email_html('Email alerts are working', 'You will get an email when an article is ready or published, when a company sends a job opportunity, when someone sends a message, and when something on the site breaks.'));
  if v_id is null then raise exception 'Add your email address and Resend API key first, and make sure alerts are switched on.'; end if;
  return json_build_object('request_id', v_id);
end $$;
revoke all on function public.send_test_email() from public, anon;
grant execute on function public.send_test_email() to authenticated;

create or replace function public.email_status(p_request_id bigint)
returns json language plpgsql stable security definer set search_path = '' as $$
declare r record;
begin
  if not public.is_admin() then raise exception 'Only admins'; end if;
  select status_code, error_msg, content into r from net._http_response where id = p_request_id;
  if not found then return json_build_object('state', 'pending'); end if;
  return json_build_object('state', case when r.status_code between 200 and 299 then 'sent' else 'failed' end,
                           'status_code', r.status_code, 'error', coalesce(r.error_msg, left(r.content, 300)));
end $$;
revoke all on function public.email_status(bigint) from public, anon;
grant execute on function public.email_status(bigint) to authenticated;

-- Internal functions are not callable through the API
revoke all on function public.send_email(text, text) from public, anon, authenticated;
revoke all on function public.dispatch_publish() from public, anon, authenticated;
revoke all on function public.publish_draft(uuid, text) from public, anon, authenticated;
revoke all on function public.publish_due_drafts() from public, anon, authenticated;
revoke all on function public.email_notification() from public, anon, authenticated;
revoke all on function public.email_html(text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.html_escape(text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'draft_reviews') then
    alter publication supabase_realtime add table public.draft_reviews;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Writer context: how many AI articles were written today (daily limit),
-- and evergreen topics the writer picks itself are saved as "manual".
-- ---------------------------------------------------------------------
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
    'recent_keywords', (select coalesce(json_agg(keyword), '[]') from public.trend_topics where created_at > now() - interval '45 days'),
    'today_ai', (select count(*) from public.posts where ai_generated and created_at >= date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London'),
    'last_ai_at', (select max(created_at) from public.posts where ai_generated)
  );
end $$;
revoke all on function public.agent_context(text) from public;
grant execute on function public.agent_context(text) to anon, authenticated;

create or replace function public.agent_save_topics(p_token text, p_topics jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.agent_ok(p_token) then raise exception 'Invalid agent token'; end if;
  insert into public.trend_topics (source, keyword, title, url, context, score, relevance, angle)
  select x.source, left(x.keyword, 160), left(coalesce(x.title, ''), 300), left(coalesce(x.url, ''), 600),
         left(coalesce(x.context, ''), 2000), coalesce(x.score, 0), greatest(0, least(100, coalesce(x.relevance, 0))), left(coalesce(x.angle, ''), 500)
    from jsonb_to_recordset(p_topics) as x(source text, keyword text, title text, url text, context text, score numeric, relevance int, angle text)
   where x.source in ('google', 'hackernews', 'devto', 'github', 'security', 'manual') and coalesce(x.keyword, '') <> ''
  on conflict (source, keyword) do update
     set title = excluded.title, url = excluded.url, context = excluded.context, score = excluded.score,
         relevance = excluded.relevance, angle = excluded.angle
   where public.trend_topics.status = 'new';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.agent_save_topics(text, jsonb) from public;
grant execute on function public.agent_save_topics(text, jsonb) to anon, authenticated;
