
create table photo_uploads (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  storage_key  text not null unique,
  width        integer not null check (width > 0),
  height       integer not null check (height > 0),
  created_at   timestamptz not null default now(),
  attached_at  timestamptz
);
create index photo_uploads_pending_idx
  on photo_uploads (profile_id, created_at) where attached_at is null;

create index reactions_post_idx on reactions (post_id) where post_id is not null;
create index reactions_comment_idx on reactions (comment_id) where comment_id is not null;
create index posts_top_idx on posts (created_at desc)
  where deleted_at is null and hidden_at is null;

grant select, insert, update on photo_uploads to app_api;
