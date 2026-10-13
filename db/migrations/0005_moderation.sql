

alter table email_codes drop constraint if exists email_codes_purpose_check;
alter table email_codes add constraint email_codes_purpose_check
  check (purpose in ('signup', 'login', 'reverify', 'close', 'appeal'));

alter table comments add column if not exists hidden_reason text;

alter table moderation.reports alter column reporter_account_id drop not null;
alter table moderation.reports add column if not exists source text not null default 'user'
  check (source in ('user', 'auto'));
alter table moderation.reports add column if not exists resolved_by text;
alter table moderation.reports drop constraint if exists reports_user_has_reporter;
alter table moderation.reports add constraint reports_user_has_reporter
  check (source <> 'user' or reporter_account_id is not null);
create unique index if not exists reports_auto_unique
  on moderation.reports (target_kind, target_id, reason) where source = 'auto';

alter table moderation.appeals add column if not exists decided_by text;
alter table moderation.appeals add column if not exists decision_note text;

create table if not exists moderation.moderators (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  token_hash  bytea not null unique,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create or replace function moderation.file_report(
  p_reporter_profile uuid,
  p_reporter_blind   bytea,
  p_target_kind      report_target,
  p_target_id        uuid,
  p_reason           report_reason,
  p_detail           text default null
) returns table (report_id uuid, is_new boolean, auto_hidden boolean)
language plpgsql
security definer
set search_path = moderation, identity, public
as $$
declare
  v_kind           profile_kind;
  v_uni            uuid;
  v_account        uuid;
  v_target_uni     uuid;
  v_target_author  uuid;
  v_report         uuid;
  v_count          integer;
  v_rows           integer;
  v_hidden         boolean := false;
begin
  select p.kind, p.university_id into v_kind, v_uni
    from profiles p where p.id = p_reporter_profile and p.deleted_at is null;
  if not found then
    raise exception 'reporter not found' using errcode = 'MD001';
  end if;

  if v_kind = 'known' then
    select account_id into v_account
      from identity.known_profile_owner where profile_id = p_reporter_profile;
  else
    if p_reporter_blind is null then
      raise exception 'blind index required' using errcode = 'MD003';
    end if;
    select account_id into v_account
      from identity.anonymous_links where anon_blind_index = p_reporter_blind;
  end if;
  if v_account is null then
    raise exception 'reporter not found' using errcode = 'MD001';
  end if;

  -- Limit per person, not per profile.
  if (select count(*) from moderation.reports
       where reporter_account_id = v_account
         and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'rate limited' using errcode = 'MD002';
  end if;

  if p_target_kind = 'post' then
    select a.university_id, p.author_profile_id into v_target_uni, v_target_author
      from posts p join profiles a on a.id = p.author_profile_id
     where p.id = p_target_id and p.deleted_at is null and p.hidden_at is null
       and a.deleted_at is null;
  elsif p_target_kind = 'comment' then
    select a.university_id, c.author_profile_id into v_target_uni, v_target_author
      from comments c
      join posts p on p.id = c.post_id and p.deleted_at is null and p.hidden_at is null
      join profiles a on a.id = c.author_profile_id
     where c.id = p_target_id and c.deleted_at is null and c.hidden_at is null
       and a.deleted_at is null;
  else
    select a.university_id, a.id into v_target_uni, v_target_author
      from profiles a where a.id = p_target_id and a.deleted_at is null;
  end if;

  if v_target_uni is null or v_target_uni <> v_uni then
    raise exception 'target not found' using errcode = 'MD001';
  end if;
  if v_target_author = p_reporter_profile then
    raise exception 'own content' using errcode = 'MD004';
  end if;

  insert into moderation.reports
    (target_kind, target_id, reason, detail, reporter_account_id, urgent, source)
  values
    (p_target_kind, p_target_id, p_reason, left(p_detail, 1000), v_account,
     p_reason in ('threat', 'self_harm', 'intimate_image'), 'user')
  on conflict (target_kind, target_id, reporter_account_id) do nothing
  returning id into v_report;

  if v_report is null then
    select r.id into v_report from moderation.reports r
     where r.target_kind = p_target_kind and r.target_id = p_target_id
       and r.reporter_account_id = v_account;
    return query select v_report, false, false;
    return;
  end if;

  if p_target_kind in ('post', 'comment') then
    select count(distinct r.reporter_account_id) into v_count
      from moderation.reports r
     where r.target_kind = p_target_kind and r.target_id = p_target_id
       and r.status = 'open' and r.source = 'user';

    if v_count >= 3 then
      if p_target_kind = 'post' then
        update posts set hidden_at = now(), hidden_reason = 'auto_reports'
         where id = p_target_id and hidden_at is null;
      else
        update comments set hidden_at = now(), hidden_reason = 'auto_reports'
         where id = p_target_id and hidden_at is null;
      end if;
      get diagnostics v_rows = row_count;
      v_hidden := v_rows > 0;
    end if;
  end if;

  return query select v_report, true, v_hidden;
end $$;

create or replace function moderation.file_auto_flag(
  p_target_kind report_target,
  p_target_id   uuid,
  p_reason      report_reason
) returns uuid
language plpgsql
security definer
set search_path = moderation, public
as $$
declare
  v_id uuid;
begin
  if p_reason <> 'self_harm' or p_target_kind not in ('post', 'comment') then
    raise exception 'unsupported automatic flag' using errcode = 'MD001';
  end if;

  if p_target_kind = 'post' then
    perform 1 from posts where id = p_target_id and deleted_at is null;
  else
    perform 1 from comments where id = p_target_id and deleted_at is null;
  end if;
  if not found then
    raise exception 'target not found' using errcode = 'MD001';
  end if;

  insert into moderation.reports (target_kind, target_id, reason, urgent, source)
  values (p_target_kind, p_target_id, p_reason, true, 'auto')
  on conflict (target_kind, target_id, reason) where source = 'auto' do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function identity.apply_penalty_to_account(
  p_account      uuid,
  p_kind         text,
  p_action_id    uuid,
  p_ends_at      timestamptz,
  p_profile_ids  uuid[]
) returns uuid
language plpgsql
security definer
set search_path = identity, public, moderation
as $$
declare
  v_penalty  uuid;
  v_ids      uuid[] := coalesce(p_profile_ids, '{}');
begin
  if p_kind not in ('warning', 'suspension', 'ban') then
    raise exception 'unknown penalty kind';
  end if;

  insert into moderation.penalties (account_id, kind, ends_at, action_id)
  values (p_account, p_kind, p_ends_at, p_action_id)
  returning id into v_penalty;

  if p_kind = 'warning' then
    update accounts set strike_count = strike_count + 1 where id = p_account;

  elsif p_kind = 'suspension' then
    update accounts set status = 'suspended'
     where id = p_account and status in ('active', 'read_only');
    update sessions set revoked_at = now()
     where account_id = p_account and revoked_at is null;

  else
    update accounts set status = 'banned' where id = p_account;

    insert into banned_emails (email_hash)
    select digest(lower(email::text), 'sha256') from accounts where id = p_account
    on conflict do nothing;

    update sessions set revoked_at = now()
     where account_id = p_account and revoked_at is null;

    v_ids := v_ids || coalesce(
      (select array_agg(profile_id) from identity.known_profile_owner where account_id = p_account),
      '{}');

    update posts set hidden_at = now(), hidden_reason = 'account_banned'
     where author_profile_id = any(v_ids) and hidden_at is null and deleted_at is null;
    update comments set hidden_at = now(), hidden_reason = 'account_banned'
     where author_profile_id = any(v_ids) and hidden_at is null and deleted_at is null;
    update profiles set deleted_at = now()
     where id = any(v_ids) and deleted_at is null;
  end if;

  return v_penalty;
end $$;

revoke all on function identity.apply_penalty_to_account(uuid, text, uuid, timestamptz, uuid[]) from public;

drop function if exists identity.apply_penalty_for_profile(bytea, text, uuid, timestamptz);

create or replace function identity.apply_penalty_for_profile(
  p_blind_index  bytea,
  p_kind         text,
  p_action_id    uuid,
  p_ends_at      timestamptz default null,
  p_profile_id   uuid default null
) returns uuid
language plpgsql
security definer
set search_path = identity, public, moderation
as $$
declare
  v_account uuid;
begin
  select account_id into v_account
    from identity.anonymous_links where anon_blind_index = p_blind_index;
  if v_account is null then
    raise exception 'no account for that profile';
  end if;
  return identity.apply_penalty_to_account(
    v_account, p_kind, p_action_id, p_ends_at,
    case when p_profile_id is null then '{}'::uuid[] else array[p_profile_id] end);
end $$;

create or replace function identity.apply_penalty_for_known_profile(
  p_profile_id  uuid,
  p_kind        text,
  p_action_id   uuid,
  p_ends_at     timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = identity, public, moderation
as $$
declare
  v_account uuid;
begin
  select account_id into v_account
    from identity.known_profile_owner where profile_id = p_profile_id;
  if v_account is null then
    raise exception 'no account for that profile';
  end if;
  return identity.apply_penalty_to_account(v_account, p_kind, p_action_id, p_ends_at, '{}'::uuid[]);
end $$;

revoke all on function identity.apply_penalty_for_profile(bytea, text, uuid, timestamptz, uuid) from public;
revoke all on function identity.apply_penalty_for_known_profile(uuid, text, uuid, timestamptz) from public;
grant execute on function identity.apply_penalty_for_profile(bytea, text, uuid, timestamptz, uuid) to moderator;
grant execute on function identity.apply_penalty_for_known_profile(uuid, text, uuid, timestamptz) to moderator;

create or replace function moderation.decide_appeal(
  p_appeal     uuid,
  p_decision   text,
  p_moderator  text,
  p_note       text default null
) returns boolean
language plpgsql
security definer
set search_path = moderation, identity, public
as $$
declare
  v_account  uuid;
  v_email    text;
begin
  if p_decision not in ('upheld', 'denied') then
    raise exception 'unknown decision';
  end if;

  select account_id into v_account
    from moderation.appeals where id = p_appeal and status = 'open' for update;
  if v_account is null then
    return false;
  end if;

  update moderation.appeals
     set status = p_decision, decided_at = now(), decided_by = p_moderator, decision_note = p_note
   where id = p_appeal;

  if p_decision = 'upheld' then
    select email::text into v_email from accounts where id = v_account;

    update accounts set status = 'active' where id = v_account and status = 'banned';
    delete from banned_emails where email_hash = digest(lower(v_email), 'sha256');
    update moderation.penalties set ends_at = now()
     where account_id = v_account and kind = 'ban' and ends_at is null;

    -- Undo what the ban hid: the known profile and its content.
    update profiles set deleted_at = null
     where deleted_at is not null
       and id in (select profile_id from identity.known_profile_owner where account_id = v_account);
    update posts set hidden_at = null, hidden_reason = null
     where hidden_reason = 'account_banned'
       and author_profile_id in
           (select profile_id from identity.known_profile_owner where account_id = v_account);
    update comments set hidden_at = null, hidden_reason = null
     where hidden_reason = 'account_banned'
       and author_profile_id in
           (select profile_id from identity.known_profile_owner where account_id = v_account);

    insert into moderation.actions (kind, moderator, note)
    values ('unban', p_moderator, left(p_note, 500));
  end if;

  return true;
end $$;

revoke all on function moderation.decide_appeal(uuid, text, text, text) from public;
grant execute on function moderation.decide_appeal(uuid, text, text, text) to moderator;

revoke select, insert on moderation.reports from app_api;
grant usage on schema moderation to app_api;
revoke all on function moderation.file_report(uuid, bytea, report_target, uuid, report_reason, text) from public;
revoke all on function moderation.file_auto_flag(report_target, uuid, report_reason) from public;
grant execute on function moderation.file_report(uuid, bytea, report_target, uuid, report_reason, text) to app_api;
grant execute on function moderation.file_auto_flag(report_target, uuid, report_reason) to app_api;

revoke select, update on moderation.reports from moderator;
grant select (id, target_kind, target_id, reason, detail, status, urgent, source,
              created_at, resolved_at, resolved_by)
  on moderation.reports to moderator;
grant update (status, resolved_at, resolved_by) on moderation.reports to moderator;
grant update (hidden_at, hidden_reason) on comments to moderator;
grant select on photo_uploads to moderator;
grant select on moderation.moderators to moderator;
revoke select on moderation.penalties from moderator;
grant select (id, kind, starts_at, ends_at, action_id, created_at) on moderation.penalties to moderator;
revoke select on moderation.appeals from moderator;
grant select (id, message, status, created_at, decided_at, decided_by, decision_note)
  on moderation.appeals to moderator;

grant usage on schema moderation to auth_service;
grant select, insert on moderation.appeals to auth_service;

grant usage on schema moderation to account_lifecycle;
grant select (account_id, kind, ends_at) on moderation.penalties to account_lifecycle;
