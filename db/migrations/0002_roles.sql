
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_api') then
    create role app_api nologin;        -- general API traffic
  end if;
  if not exists (select 1 from pg_roles where rolname = 'auth_service') then
    create role auth_service nologin;   -- mints sessions, creates anonymous profile
  end if;
  if not exists (select 1 from pg_roles where rolname = 'moderator') then
    create role moderator nologin;      -- admin dashboard
  end if;
  if not exists (select 1 from pg_roles where rolname = 'trust_safety') then
    create role trust_safety nologin;   -- small named role, restricted lookups
  end if;
end $$;

grant usage on schema public to app_api;
grant select, insert, update on posts, post_photos, comments, reactions,
      follows, notifications, push_tokens to app_api;
grant delete on reactions, follows, push_tokens to app_api;
grant select on profiles, universities to app_api;
grant select, insert on moderation.reports to app_api;   -- users can file reports
revoke all on schema identity from app_api;

grant usage on schema public, identity to auth_service;
grant select, insert, update on accounts, email_codes, sessions, profiles to auth_service;
grant select on universities to auth_service;
grant select, insert, delete on banned_emails to auth_service;
grant select, insert on identity.known_profile_owner, identity.anonymous_links to auth_service;
-- no access to identity.lookup_audit and no reverse lookup

grant usage on schema public, moderation to moderator;
grant select on profiles, posts, post_photos, comments to moderator;
grant update (hidden_at, hidden_reason) on posts to moderator;
grant update (hidden_at) on comments to moderator;
grant select, update on moderation.reports to moderator;
grant select, insert on moderation.actions to moderator;
grant select on moderation.penalties, moderation.appeals to moderator;
grant usage on schema identity to moderator;

create or replace function identity.apply_penalty_for_profile(
  p_blind_index  bytea,
  p_kind         text,
  p_action_id    uuid,
  p_ends_at      timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = identity, public, moderation
as $$
declare
  v_account  uuid;
  v_penalty  uuid;
begin
  select account_id into v_account
    from identity.anonymous_links
   where anon_blind_index = p_blind_index;

  if v_account is null then
    raise exception 'no account for that profile';
  end if;

  insert into moderation.penalties (account_id, kind, ends_at, action_id)
  values (v_account, p_kind, p_ends_at, p_action_id)
  returning id into v_penalty;

  if p_kind = 'ban' then
    update accounts set status = 'banned' where id = v_account;
  elsif p_kind = 'suspension' then
    update accounts set status = 'suspended' where id = v_account;
  elsif p_kind = 'warning' then
    update accounts set strike_count = strike_count + 1 where id = v_account;
  end if;

  return v_penalty;
end $$;

revoke all on function identity.apply_penalty_for_profile(bytea, text, uuid, timestamptz) from public;
grant execute on function identity.apply_penalty_for_profile(bytea, text, uuid, timestamptz) to moderator;

create or replace function identity.unmask_profile(
  p_blind_index   bytea,
  p_actor         text,
  p_reason_code   text,
  p_reason_detail text,
  p_case_ref      text default null,
  p_approved_by   text default null
) returns uuid
language plpgsql
security definer
set search_path = identity, public
as $$
declare
  v_account uuid;
begin
  insert into identity.lookup_audit
    (actor, actor_role, reason_code, reason_detail, case_ref, approved_by)
  values
    (p_actor, session_user, p_reason_code, p_reason_detail, p_case_ref, p_approved_by);

  select account_id into v_account
    from identity.anonymous_links
   where anon_blind_index = p_blind_index;

  return v_account;
end $$;

revoke all on function identity.unmask_profile(bytea, text, text, text, text, text) from public;
grant usage on schema identity to trust_safety;
grant execute on function identity.unmask_profile(bytea, text, text, text, text, text) to trust_safety;
grant select on identity.lookup_audit to trust_safety;
