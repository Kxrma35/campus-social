

alter table moderation.penalties add column if not exists expired_at timestamptz;
alter table moderation.appeals add column if not exists scrubbed_at timestamptz;

create table if not exists moderation.legal_holds (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null check (scope in ('target', 'account', 'audit_case')),
  target_kind  report_target,
  target_id    uuid,
  account_id   uuid references accounts(id),
  case_ref     text,
  reason       text not null check (length(reason) >= 10),
  placed_by    text not null,
  placed_at    timestamptz not null default now(),
  released_at  timestamptz,
  released_by  text,
  constraint legal_holds_scope_shape check (
       (scope = 'target'     and target_kind is not null and target_id is not null
                              and account_id is null and case_ref is null)
    or (scope = 'account'    and account_id is not null
                              and target_kind is null and target_id is null and case_ref is null)
    or (scope = 'audit_case' and case_ref is not null
                              and target_kind is null and target_id is null and account_id is null)
  )
);
create index if not exists legal_holds_active_idx
  on moderation.legal_holds (scope) where released_at is null;

create table if not exists identity.lookup_audit_purges (
  id            bigint generated always as identity primary key,
  purged_at     timestamptz not null default now(),
  rows_deleted  integer not null check (rows_deleted > 0),
  older_than    timestamptz not null
);

create or replace function identity.block_purge_log_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'identity.lookup_audit_purges is append-only';
end $$;

drop trigger if exists lookup_audit_purges_no_change on identity.lookup_audit_purges;
create trigger lookup_audit_purges_no_change
  before update or delete on identity.lookup_audit_purges
  for each row execute function identity.block_purge_log_mutation();

create or replace function identity.block_audit_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('campus.audit_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'identity.lookup_audit is append-only';
end $$;

create or replace function moderation.purge_expired_records(
  p_now             timestamptz,
  p_dismissed_days  integer,
  p_resolved_days   integer,
  p_appeal_days     integer,
  p_warning_months  integer,
  p_audit_years     integer
) returns table (
  out_warnings_expired   integer,
  out_reports_purged     integer,
  out_actions_purged     integer,
  out_penalties_purged   integer,
  out_appeals_scrubbed   integer,
  out_audit_rows_purged  integer
)
language plpgsql
security definer
set search_path = moderation, identity, public
as $$
declare
  v_warn      integer := 0;
  v_reports   integer := 0;
  v_actions   integer := 0;
  v_penalties integer := 0;
  v_appeals   integer := 0;
  v_audit     integer := 0;
  v_ids       uuid[];
begin
  if p_dismissed_days < 30 or p_resolved_days < 180 or p_appeal_days < 180
     or p_warning_months < 3 or p_audit_years < 1 then
    raise exception 'retention period below the allowed floor' using errcode = 'MD010';
  end if;

  with expired as (
    update moderation.penalties p
       set expired_at = p_now
     where p.kind = 'warning' and p.expired_at is null
       and p.starts_at < p_now - make_interval(months => p_warning_months)
    returning p.account_id
  ),
  per_account as (
    select account_id, count(*)::int as n from expired group by account_id
  ),
  lowered as (
    update accounts a
       set strike_count = greatest(0, a.strike_count - per_account.n)
      from per_account
     where a.id = per_account.account_id
    returning 1
  )
  select count(*)::int into v_warn from expired;

  select coalesce(array_agg(r.id), '{}') into v_ids
    from moderation.reports r
   where (
           (r.status = 'dismissed'
              and r.resolved_at < p_now - make_interval(days => p_dismissed_days))
        or (r.status = 'actioned'
              and r.resolved_at < p_now - make_interval(days => p_resolved_days))
         )
     and not exists (
           select 1 from moderation.legal_holds h
            where h.released_at is null and h.scope = 'target'
              and h.target_kind = r.target_kind and h.target_id = r.target_id);

  if cardinality(v_ids) > 0 then
    update moderation.actions set report_id = null where report_id = any(v_ids);
    delete from moderation.reports where id = any(v_ids);
    v_reports := cardinality(v_ids);
  end if;

  with gone as (
    delete from moderation.penalties p
     where (
             (p.kind = 'warning' and p.expired_at is not null)
          or (p.kind in ('suspension', 'ban') and p.ends_at is not null
                and p.ends_at < p_now - make_interval(days => p_resolved_days))
           )
       and not exists (
             select 1 from moderation.legal_holds h
              where h.released_at is null and h.scope = 'account'
                and h.account_id = p.account_id)
    returning 1
  )
  select count(*)::int into v_penalties from gone;

  -- 4. Actions, once nothing in force still depends on them.
  with gone as (
    delete from moderation.actions a
     where a.created_at < p_now - make_interval(days => p_resolved_days)
       and not exists (select 1 from moderation.penalties p where p.action_id = a.id)
       and not exists (
             select 1 from moderation.legal_holds h
              where h.released_at is null and h.scope = 'target'
                and h.target_kind = a.target_kind and h.target_id = a.target_id)
    returning 1
  )
  select count(*)::int into v_actions from gone;

  with scrubbed as (
    update moderation.appeals ap
       set message = '', decision_note = null, decided_by = null, scrubbed_at = p_now
     where ap.status in ('upheld', 'denied')
       and ap.scrubbed_at is null
       and ap.decided_at < p_now - make_interval(days => p_appeal_days)
       and not exists (
             select 1 from moderation.legal_holds h
              where h.released_at is null and h.scope = 'account'
                and h.account_id = ap.account_id)
    returning 1
  )
  select count(*)::int into v_appeals from scrubbed;

  perform set_config('campus.audit_purge', 'on', true);
  with gone as (
    delete from identity.lookup_audit a
     where a.looked_up_at < p_now - make_interval(years => p_audit_years)
       and not exists (
             select 1 from moderation.legal_holds h
              where h.released_at is null and h.scope = 'audit_case'
                and h.case_ref = a.case_ref)
    returning 1
  )
  select count(*)::int into v_audit from gone;
  perform set_config('campus.audit_purge', 'off', true);

  if v_audit > 0 then
    insert into identity.lookup_audit_purges (rows_deleted, older_than)
    values (v_audit, p_now - make_interval(years => p_audit_years));
  end if;

  return query select v_warn, v_reports, v_actions, v_penalties, v_appeals, v_audit;
end $$;

revoke all on function moderation.purge_expired_records(timestamptz, integer, integer, integer, integer, integer) from public;
grant execute on function moderation.purge_expired_records(timestamptz, integer, integer, integer, integer, integer)
  to account_lifecycle;

revoke all on moderation.legal_holds from app_api, auth_service, moderator, account_lifecycle, trust_safety;
revoke all on identity.lookup_audit_purges from app_api, auth_service, moderator, account_lifecycle;
grant select on identity.lookup_audit_purges to trust_safety;
