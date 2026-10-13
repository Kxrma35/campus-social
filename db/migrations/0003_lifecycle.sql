

alter table email_codes drop constraint if exists email_codes_purpose_check;
alter table email_codes add constraint email_codes_purpose_check
  check (purpose in ('signup', 'login', 'reverify', 'close'));

alter table accounts alter column date_of_birth drop not null;
alter table accounts add column if not exists purged_at timestamptz;
create index if not exists accounts_closed_idx
  on accounts (closed_at) where status = 'closed' and purged_at is null;

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
    insert into banned_emails (email_hash)
    select digest(lower(email::text), 'sha256') from accounts where id = v_account
    on conflict do nothing;
  elsif p_kind = 'suspension' then
    update accounts set status = 'suspended' where id = v_account;
  elsif p_kind = 'warning' then
    update accounts set strike_count = strike_count + 1 where id = v_account;
  end if;

  return v_penalty;
end $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'account_lifecycle') then
    create role account_lifecycle nologin;
  end if;
end $$;

grant usage on schema public, identity to account_lifecycle;

grant select, update on accounts to account_lifecycle;
grant select, update, delete on sessions to account_lifecycle;
grant select, delete on email_codes to account_lifecycle;

grant select on identity.known_profile_owner to account_lifecycle;
grant delete on identity.anonymous_links to account_lifecycle;

grant select, delete on profiles to account_lifecycle;
grant update (deleted_at) on profiles, posts, comments to account_lifecycle;

grant select, delete on posts, comments, reactions, follows, notifications,
      push_tokens to account_lifecycle;
grant select on post_photos to account_lifecycle;

revoke select on identity.anonymous_links from auth_service, account_lifecycle;
grant select (account_id, anon_profile_enc) on identity.anonymous_links
  to auth_service, account_lifecycle;
