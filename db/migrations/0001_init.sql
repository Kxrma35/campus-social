
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;

create schema if not exists identity;
create schema if not exists moderation;

create type account_status as enum (
  'active',
  'read_only',
  'suspended',     -- temporary moderation suspension
  'banned',
  'closed'         -- user closed, graduated, or grace period expired
);

create type profile_kind as enum ('known', 'anonymous');
create type report_target as enum ('post', 'comment', 'profile');
create type report_reason as enum (
  'threat', 'harassment', 'private_info', 'intimate_image',
  'hate', 'self_harm', 'impersonation', 'other'
);
create type report_status as enum ('open', 'actioned', 'dismissed');
create type moderation_action_kind as enum (
  'hide_content', 'restore_content', 'warn', 'suspend', 'ban', 'unban', 'close_report'
);

create table universities (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email_domain  citext not null unique,    -- e.g. usiu.ac.ke
  active        boolean not null default false,
  created_at    timestamptz not null default now()
);

create table accounts (
  id                    uuid primary key default gen_random_uuid(),
  university_id         uuid not null references universities(id),
  email                 citext not null unique,
  date_of_birth         date not null,
  terms_accepted_at     timestamptz not null,
  terms_version         text not null,
  status                account_status not null default 'active',
  strike_count          integer not null default 0 check (strike_count >= 0),
  email_verified_at     timestamptz not null,
  last_reverified_at    timestamptz not null,
  reverify_due_at       timestamptz not null,
  two_factor_enabled    boolean not null default false,
  closed_at             timestamptz,
  closed_reason         text,
  created_at            timestamptz not null default now()
);
create index accounts_university_idx on accounts (university_id);
create index accounts_reverify_due_idx on accounts (reverify_due_at) where status = 'active';

create table banned_emails (
  email_hash   bytea primary key,
  banned_at    timestamptz not null default now()
);

create table email_codes (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null,
  code_hash     bytea not null,
  purpose       text not null check (purpose in ('signup', 'login', 'reverify')),
  expires_at    timestamptz not null,   -- created_at + 10 minutes
  consumed_at   timestamptz,
  attempts      integer not null default 0,
  created_at    timestamptz not null default now()
);
create index email_codes_email_idx on email_codes (email, created_at desc);

create table sessions (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id) on delete cascade,
  refresh_hash    bytea not null unique,
  device_label    text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz
);
create index sessions_account_idx on sessions (account_id);

create table profiles (
  id            uuid primary key default gen_random_uuid(),
  kind          profile_kind not null,
  university_id uuid not null references universities(id),
  handle        citext not null,            -- generated for anonymous
  display_name  text,                       -- real name for known, null for anonymous
  avatar_key    text,
  course        text,
  study_year    smallint check (study_year between 1 and 8),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint profiles_known_has_name check (kind <> 'known' or display_name is not null),
  constraint profiles_anon_no_realname check (kind <> 'anonymous' or (display_name is null and course is null and study_year is null)),
  unique (university_id, handle)
);
-- Name search covers known profiles only.
create index profiles_known_name_idx on profiles (university_id, lower(display_name)) where kind = 'known' and deleted_at is null;

create table identity.known_profile_owner (
  account_id  uuid primary key references accounts(id) on delete cascade,
  profile_id  uuid not null unique references profiles(id) on delete cascade
);

create table identity.anonymous_links (
  account_id        uuid primary key references accounts(id) on delete cascade,
  anon_profile_enc  bytea not null,
  anon_blind_index  bytea not null unique,
  key_version       smallint not null default 1,
  created_at        timestamptz not null default now()
);

create table identity.lookup_audit (
  id             bigint generated always as identity primary key,
  looked_up_at   timestamptz not null default now(),
  actor          text not null,        -- staff identifier
  actor_role     text not null,
  reason_code    text not null check (reason_code in (
                   'confirmed_threat', 'targeted_harassment', 'intimate_image',
                   'private_info_exposure', 'court_order')),
  reason_detail  text not null check (length(reason_detail) >= 20),
  case_ref       text,                 -- report id or court order reference
  approved_by    text                  -- second approver where policy requires
);

create or replace function identity.block_audit_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'identity.lookup_audit is append-only';
end $$;

create trigger lookup_audit_no_update
  before update or delete on identity.lookup_audit
  for each row execute function identity.block_audit_mutation();

create table posts (
  id                uuid primary key default gen_random_uuid(),
  author_profile_id uuid not null references profiles(id),
  body              text not null check (length(body) <= 5000),
  created_at        timestamptz not null default now(),
  edited_at         timestamptz,
  deleted_at        timestamptz,        -- removed from feeds immediately; purged within 30 days
  hidden_at         timestamptz,
  hidden_reason     text
);
create index posts_feed_idx on posts (created_at desc) where deleted_at is null and hidden_at is null;
create index posts_author_idx on posts (author_profile_id, created_at desc);

create table post_photos (
  post_id      uuid not null references posts(id) on delete cascade,
  position     smallint not null check (position between 0 and 3),
  storage_key  text not null,                                         -- EXIF stripped before storing
  width        integer,
  height       integer,
  primary key (post_id, position)
);

create table comments (
  id                uuid primary key default gen_random_uuid(),
  post_id           uuid not null references posts(id) on delete cascade,
  author_profile_id uuid not null references profiles(id),
  body              text not null check (length(body) <= 2000),
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  hidden_at         timestamptz
);
create index comments_post_idx on comments (post_id, created_at);

create table reactions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id),
  post_id     uuid references posts(id) on delete cascade,
  comment_id  uuid references comments(id) on delete cascade,
  kind        text not null default 'like',
  created_at  timestamptz not null default now(),
  check ((post_id is not null) <> (comment_id is not null)),
  unique (profile_id, post_id, kind),
  unique (profile_id, comment_id, kind)
);

create table follows (
  follower_profile_id  uuid not null references profiles(id) on delete cascade,
  followee_profile_id  uuid not null references profiles(id) on delete cascade,
  created_at           timestamptz not null default now(),
  primary key (follower_profile_id, followee_profile_id),
  check (follower_profile_id <> followee_profile_id)
);
create index follows_followee_idx on follows (followee_profile_id);

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  kind        text not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index notifications_profile_idx on notifications (profile_id, created_at desc);

create table push_tokens (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  token       text not null unique,
  platform    text not null check (platform in ('android', 'ios')),
  created_at  timestamptz not null default now()
);

create table moderation.reports (
  id                    uuid primary key default gen_random_uuid(),
  target_kind           report_target not null,
  target_id             uuid not null,
  reason                report_reason not null,
  detail                text check (length(detail) <= 1000),
  reporter_account_id   uuid not null references accounts(id),
  status                report_status not null default 'open',
  urgent                boolean not null default false,   -- threat, self_harm, intimate_image
  created_at            timestamptz not null default now(),
  resolved_at           timestamptz,
  unique (target_kind, target_id, reporter_account_id)
);
create index reports_queue_idx on moderation.reports (urgent desc, created_at) where status = 'open';
create index reports_target_idx on moderation.reports (target_kind, target_id);

create table moderation.actions (
  id              uuid primary key default gen_random_uuid(),
  kind            moderation_action_kind not null,
  moderator       text not null,
  report_id       uuid references moderation.reports(id),
  target_kind     report_target,
  target_id       uuid,
  note            text,
  created_at      timestamptz not null default now()
);

create table moderation.penalties (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id),
  kind          text not null check (kind in ('warning', 'suspension', 'ban')),
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,
  action_id     uuid references moderation.actions(id),
  created_at    timestamptz not null default now()
);
create index penalties_account_idx on moderation.penalties (account_id);

create table moderation.appeals (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null unique references accounts(id),   -- one appeal per account
  message       text not null check (length(message) <= 2000),
  status        text not null default 'open' check (status in ('open', 'upheld', 'denied')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);

insert into universities (name, email_domain, active)
values ('United States International University - Africa', 'usiu.ac.ke', false)
on conflict do nothing;
