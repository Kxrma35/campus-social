-- Profile photo for known profiles. Anonymous profiles can never have one.
-- Moderation is after the fact: reported photos are removed by a moderator.

alter table profiles
  add column avatar_upload_id uuid references photo_uploads(id) on delete set null;

alter table profiles
  add constraint profiles_avatar_known_only
  check (avatar_upload_id is null or kind = 'known');

alter type moderation_action_kind add value if not exists 'avatar_removed';

-- The student sets or clears their own photo through the content API.
grant update (avatar_upload_id) on profiles to app_api;

-- A moderator removes a photo: the link is cleared and the upload is released so the
-- retention job deletes the file with the other unattached uploads.
grant update (avatar_upload_id) on profiles to moderator;
grant update (attached_at) on photo_uploads to moderator;
