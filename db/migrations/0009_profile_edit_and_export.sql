

alter table profiles add column if not exists edit_window_started_at timestamptz;
alter table profiles add column if not exists edits_in_window integer not null default 0
  check (edits_in_window >= 0);

create or replace function moderation.export_account_records(
  p_account      uuid,
  p_profile_ids  uuid[]
) returns jsonb
language sql
stable
security definer
set search_path = moderation, public
as $$
  with mine_posts as (
    select id from posts where author_profile_id = any(p_profile_ids)
  ),
  mine_comments as (
    select id from comments where author_profile_id = any(p_profile_ids)
  )
  select jsonb_build_object(
    'reportsFiled', coalesce((
      select jsonb_agg(jsonb_build_object(
               'targetKind', r.target_kind, 'targetId', r.target_id,
               'reason', r.reason, 'detail', r.detail,
               'status', r.status, 'createdAt', r.created_at)
             order by r.created_at)
        from moderation.reports r
       where r.reporter_account_id = p_account
    ), '[]'::jsonb),

    'reportsAboutYourContent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'targetKind', r.target_kind, 'targetId', r.target_id,
               'reason', r.reason, 'source', r.source,
               'status', r.status, 'createdAt', r.created_at)
             order by r.created_at)
        from moderation.reports r
       where (r.target_kind = 'profile' and r.target_id = any(p_profile_ids))
          or (r.target_kind = 'post'    and r.target_id in (select id from mine_posts))
          or (r.target_kind = 'comment' and r.target_id in (select id from mine_comments))
    ), '[]'::jsonb),

    'penalties', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', p.kind, 'startsAt', p.starts_at, 'endsAt', p.ends_at,
               'expiredAt', p.expired_at, 'reason', a.note)
             order by p.starts_at)
        from moderation.penalties p
        left join moderation.actions a on a.id = p.action_id
       where p.account_id = p_account
    ), '[]'::jsonb),

    'actionsOnYourContent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', a.kind, 'targetKind', a.target_kind, 'targetId', a.target_id,
               'note', a.note, 'createdAt', a.created_at)
             order by a.created_at)
        from moderation.actions a
       where (a.target_kind = 'profile' and a.target_id = any(p_profile_ids))
          or (a.target_kind = 'post'    and a.target_id in (select id from mine_posts))
          or (a.target_kind = 'comment' and a.target_id in (select id from mine_comments))
    ), '[]'::jsonb),

    'appeals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'message', ap.message, 'status', ap.status,
               'createdAt', ap.created_at, 'decidedAt', ap.decided_at,
               'decisionNote', ap.decision_note)
             order by ap.created_at)
        from moderation.appeals ap
       where ap.account_id = p_account
    ), '[]'::jsonb)
  );
$$;

revoke all on function moderation.export_account_records(uuid, uuid[]) from public;
grant execute on function moderation.export_account_records(uuid, uuid[]) to account_lifecycle;
