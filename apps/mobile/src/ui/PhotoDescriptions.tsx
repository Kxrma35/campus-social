import { useState } from "react";
import { View } from "react-native";
import type { PostPhoto } from "@/core/api/types";
import { describeError } from "@/core/lib/errors";
import { MAX_ALT_TEXT } from "@/core/lib/validation";
import { spacing } from "@/theme/tokens";
import { Button } from "./Button";
import { Notice } from "./Notice";
import { Text } from "./Text";
import { TextField } from "./TextField";

export function PhotoDescriptions({
  photos,
  onSave,
}: {
  photos: PostPhoto[];
  onSave: (photoId: string, altText: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (photos.length === 0) return null;

  function start(p: PostPhoto) {
    setEditing(p.id);
    setDraft(p.altText ?? "");
    setError(null);
  }

  async function save(p: PostPhoto) {
    const text = draft.replace(/\s+/g, " ").trim();
    if (text.length > MAX_ALT_TEXT) {
      setError(`Photo descriptions can be at most ${MAX_ALT_TEXT} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(p.id, text.length > 0 ? text : null);
      setEditing(null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing.md }}>
      <Text variant="heading">Photo descriptions</Text>
      <Text tone="muted">
        Descriptions are read aloud to people who use a screen reader. Only you can change them.
      </Text>
      {photos.map((p, i) => {
        const n = i + 1;
        const isEditing = editing === p.id;
        return (
          <View key={p.id} style={{ gap: spacing.xs }}>
            <Text variant="label">{`Photo ${n} of ${photos.length}`}</Text>
            {isEditing ? (
              <View style={{ gap: spacing.sm }}>
                <TextField
                  label={`Description of photo ${n}`}
                  value={draft}
                  onChangeText={setDraft}
                  maxLength={MAX_ALT_TEXT}
                  multiline
                  testID={`edit-alt-${i}`}
                />
                {error ? <Notice tone="error">{error}</Notice> : null}
                <Button label="Save description" onPress={() => save(p)} busy={busy} testID={`save-alt-${i}`} />
                <Button variant="link" label="Cancel" onPress={() => setEditing(null)} />
              </View>
            ) : (
              <View style={{ gap: spacing.xs }}>
                <Text tone={p.altText ? undefined : "muted"}>{p.altText ?? "No description yet."}</Text>
                <Button
                  variant="secondary"
                  label={p.altText ? "Edit description" : "Add description"}
                  accessibilityLabel={`${p.altText ? "Edit" : "Add"} description of photo ${n}`}
                  onPress={() => start(p)}
                  testID={`open-alt-${i}`}
                />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
