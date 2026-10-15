import { useState } from "react";
import { View } from "react-native";
import { describeError } from "@/core/lib/errors";
import { MAX_POST_LENGTH } from "@/core/lib/validation";
import { spacing } from "@/theme/tokens";
import { Button } from "./Button";
import { Notice } from "./Notice";
import { Text } from "./Text";
import { TextField } from "./TextField";

export function PostEditor({
  body,
  onSave,
}: {
  body: string;
  onSave: (text: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setDraft(body);
    setError(null);
    setEditing(true);
  }

  async function save() {
    const text = draft.trim();
    if (text.length === 0) {
      setError("Write something to keep this post. To remove it, delete the post instead.");
      return;
    }
    if (text.length > MAX_POST_LENGTH) {
      setError(`Posts can be at most ${MAX_POST_LENGTH} characters.`);
      return;
    }
    if (text === body.trim()) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(text);
      setEditing(false);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return <Button variant="secondary" label="Edit post" onPress={open} testID="open-edit-post" />;
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="heading">Edit your post</Text>
      <Text tone="muted">
        People will see that the post was edited. Photos cannot be changed; you can describe them
        below.
      </Text>
      <TextField
        label="Post text"
        value={draft}
        onChangeText={setDraft}
        multiline
        maxLength={MAX_POST_LENGTH}
        hint={`${draft.length} / ${MAX_POST_LENGTH}`}
        testID="edit-post-body"
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button label="Save changes" onPress={save} busy={busy} testID="save-post" />
      <Button variant="link" label="Cancel" onPress={() => setEditing(false)} />
    </View>
  );
}
