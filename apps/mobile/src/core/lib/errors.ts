import { ApiError, NetworkError } from "@/core/api/client";

const BY_CODE: Record<string, string> = {
  university_not_supported:
    "That email address is not from a university that can use Moku yet.",
  invalid_code: "That code is not right. Check it and try again.",
  code_expired: "That code has expired. Request a new one.",
  too_many_attempts: "Too many wrong codes. Request a new code to try again.",
  too_many_requests: "Too many codes requested. Please wait a while and try again.",
  must_be_18: "You must be 18 or older to use Moku.",
  invalid_date_of_birth: "Check your date of birth and try again.",
  account_exists: "An account already exists for that email. Sign in instead.",
  account_suspended: "This account is suspended right now.",
  unauthorized: "Please sign in again.",
  rate_limited: "You are doing that too fast. Please wait a little and try again.",
  read_only:
    "Your account is read-only until you re-verify your email. You can still read and download your data.",
  anonymous_locked: "Anonymous profiles are not available for your account right now.",
  anonymous_unavailable: "Your anonymous profile is temporarily unavailable. Please try again later.",
  no_anonymous_profile: "You have not created an anonymous profile yet.",
  empty_post: "Write something or add a photo.",
  invalid_body: "Posts must be between 1 and 5000 characters.",
  under_review: "This post can't be edited right now. Please try again later.",
  body_too_long: "That post is too long.",
  too_many_photos: "A post can have at most 4 photos.",
  photo_invalid: "One of the photos could not be used. Try picking it again.",
  invalid_image: "That image could not be used. Try a JPEG, PNG or WebP photo.",
  image_too_large: "That image is too large. The limit is 8 MB.",
  too_many_uploads: "Finish posting your current photos before adding more.",
  too_many_edits: "You have changed your profile a lot recently. Please try again later.",
  not_found: "That could not be found. It may have been removed.",
  own_content: "You cannot report your own content.",
  already_appealed: "An appeal has already been sent for this account.",
  not_available: "That is not available yet.",
  cannot_close: "This account cannot be closed right now.",
  invalid_cursor: "The list could not be loaded. Pull down to refresh.",
};

export function describeError(err: unknown): string {
  if (err instanceof NetworkError) {
    return "Can't reach the server. Check your connection and try again.";
  }
  if (err instanceof ApiError) {
    const known = BY_CODE[err.code];
    if (known) return known;
    if (err.status >= 500) return "Something went wrong on our side. Please try again.";
    if (err.message && err.message !== "Something went wrong.") return err.message;
  }
  return "Something went wrong. Please try again.";
}

export function isCode(err: unknown, code: string): boolean {
  return err instanceof ApiError && err.code === code;
}
