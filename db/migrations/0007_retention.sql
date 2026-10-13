
create table storage_deletions (
  storage_key  text primary key,
  queued_at    timestamptz not null default now()
);

-- Indexes so the cleanup queries do not scan whole tables.
create index posts_deleted_idx on posts (deleted_at) where deleted_at is not null;
create index comments_deleted_idx on comments (deleted_at) where deleted_at is not null;
create index email_codes_created_idx on email_codes (created_at);
create index sessions_expires_idx on sessions (expires_at);
create index photo_uploads_stale_idx on photo_uploads (created_at) where attached_at is null;

grant select, delete on photo_uploads to account_lifecycle;
grant select, insert, delete on storage_deletions to account_lifecycle;

grant select (target_kind, target_id, status) on moderation.reports to account_lifecycle;
