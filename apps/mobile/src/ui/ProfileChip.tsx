import type { ProfileKind } from "@/core/api/types";
import { IdentityBadge } from "./IdentityBadge";

export function ProfileChip({
  kind,
  self = false,
  prefix,
}: {
  kind: ProfileKind;
  /** True when this is the viewer's own profile ("You"). */
  self?: boolean;
  /** For example "Posting as". */
  prefix?: string;
}) {
  const anonymous = kind === "anonymous";
  const word = anonymous ? "Anonymous" : self ? "You" : "Student";
  const text = prefix ? `${prefix} ${word.toLowerCase()}` : word;
  return (
    <IdentityBadge
      kind={kind}
      label={text}
      accessibilityLabel={`${prefix ? prefix + " " : ""}${anonymous ? "anonymous profile" : self ? "your known profile" : "known profile"}`}
    />
  );
}
