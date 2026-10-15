create or replace function moderation.post_has_open_report(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, moderation
as $$
  select exists (
    select 1
      from moderation.reports r
     where r.target_kind = 'post'
       and r.target_id = p_post_id
       and r.status = 'open'
  )
$$;

revoke all on function moderation.post_has_open_report(uuid) from public;
grant execute on function moderation.post_has_open_report(uuid) to app_api;
