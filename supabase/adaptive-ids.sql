-- =====================================================================
--  Adaptive IDS enquiries in the admin panel.
--  Run after autopilot.sql (Dashboard → SQL Editor → New query → Run).
--  Safe to run again.
--
--  The adaptiveids.com "Request an evaluation" form saves to
--  public.adaptive_ids_evaluation_requests in this same project (created by
--  tools/site/supabase-evaluation-requests.sql in the Ml-Detection-Project
--  repository). Visitors can only add a request; this file lets admins read,
--  track, annotate and delete them, adds a notification for each new one and
--  an optional email alert.
-- =====================================================================

-- Pipeline stage, private notes and last-change time.
alter table public.adaptive_ids_evaluation_requests
  add column if not exists status text not null default 'new',
  add column if not exists notes text not null default '',
  add column if not exists updated_at timestamptz not null default now();
alter table public.adaptive_ids_evaluation_requests
  drop constraint if exists adaptive_ids_evaluation_requests_status_check,
  add constraint adaptive_ids_evaluation_requests_status_check
    check (status in ('new','contacted','call','evaluation','won','declined','closed')),
  drop constraint if exists adaptive_ids_evaluation_requests_notes_check,
  add constraint adaptive_ids_evaluation_requests_notes_check check (char_length(notes) <= 10000);
create index if not exists adaptive_ids_evaluation_requests_created_idx
  on public.adaptive_ids_evaluation_requests (created_at desc);

-- Visitors' column-level insert grant does not include status or notes, so a
-- new request always starts as 'new' with no notes. Admins manage everything.
drop policy if exists "admins manage evaluation requests" on public.adaptive_ids_evaluation_requests;
create policy "admins manage evaluation requests" on public.adaptive_ids_evaluation_requests
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, delete on public.adaptive_ids_evaluation_requests to authenticated;
grant update (status, notes) on public.adaptive_ids_evaluation_requests to authenticated;

drop trigger if exists touch_updated_at on public.adaptive_ids_evaluation_requests;
create trigger touch_updated_at before update on public.adaptive_ids_evaluation_requests
  for each row execute function public.touch_updated_at();

-- The admin panel's live updates.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'adaptive_ids_evaluation_requests'
  ) then
    alter publication supabase_realtime add table public.adaptive_ids_evaluation_requests;
  end if;
end $$;

-- Notifications: allow the new kind, and add one for each request.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('message','opportunity','evaluation','publish','deploy','content','health','info'));

create or replace function public.notify_evaluation_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify('evaluation', 'success',
    new.organisation || ' wants an Adaptive IDS ' ||
      case new.interest when 'evaluation' then 'evaluation' when 'feedback_call' then 'feedback call'
                        when 'partnership' then 'partnership' else 'conversation' end,
    new.name || coalesce(' · ' || nullif(new.role, ''), '') || ' · ' || replace(new.organisation_type, '_', ' ')
      || coalesce(' · ' || left(nullif(new.message, ''), 160), ''),
    '#evaluations');
  return null;
end $$;
revoke all on function public.notify_evaluation_request() from public, anon, authenticated;
drop trigger if exists notify_evaluation_request on public.adaptive_ids_evaluation_requests;
create trigger notify_evaluation_request after insert on public.adaptive_ids_evaluation_requests
  for each row execute function public.notify_evaluation_request();
