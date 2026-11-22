-- =====================================================================
--  Security hardening. Run after the other files. Safe to run again.
-- =====================================================================

-- Admin rights need the second sign-in step once an authenticator is set up.
-- A stolen password alone then cannot read private data or change the site.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
     and (
       coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
       or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
     );
$$;

-- Weekly backup (GitHub Actions, encrypted before it is stored): every portfolio
-- table, read with the writer's token. Uploaded files live in Storage and are
-- also copied into the site at each build.
create or replace function public.agent_backup(p_token text)
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v json;
  t text;
  parts jsonb := '{}';
begin
  if not public.agent_ok(p_token) then raise exception 'Invalid agent token'; end if;
  foreach t in array array['profile','projects','posts','certifications','timeline','skills','services','stats',
                           'focus_areas','site_text','messages','opportunities','adaptive_ids_evaluation_requests',
                           'trend_topics','draft_reviews','agent_runs','notifications','alert_settings','site_state','page_views'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select coalesce(json_agg(x), ''[]'') from public.%I x', t) into v;
      parts := parts || jsonb_build_object(t, v);
    end if;
  end loop;
  return json_build_object('taken_at', now(), 'tables', parts);
end $$;
revoke all on function public.agent_backup(text) from public;
grant execute on function public.agent_backup(text) to anon, authenticated;
