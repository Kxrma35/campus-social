import { router } from "expo-router";
import { useState } from "react";
import { Image, View } from "react-native";
import type { Post, ProfileKind } from "@/core/api/types";
import { ANONYMITY_NOTICE } from "@/core/constants";
import { describeError, isCode } from "@/core/lib/errors";
import { MAX_ALT_TEXT, MAX_PHOTOS, MAX_POST_LENGTH } from "@/core/lib/validation";
import { pickAndUpload } from "@/core/photos";
import type { PickedPhoto } from "@/core/photos";
import { useIdentity } from "@/core/session/IdentityProvider";
import { useSession } from "@/core/session/SessionProvider";
import { radius, spacing } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { ProfileChip } from "@/ui/ProfileChip";
import { Screen } from "@/ui/Screen";
import { SupportPanel } from "@/ui/SupportPanel";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { useTheme } from "@/ui/theme";

export default function ComposeScreen() {
  const { api } = useSession();
  const { profiles, canUseAnonymous } = useIdentity();
  const t = useTheme();

  const [as, setAs] = useState<ProfileKind>("known");
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  // Description per photo, keyed by upload id. Optional.
  const [alts, setAlts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [posted, setPosted] = useState<Post | null>(null);

  const anonymous = as === "anonymous";
  const handle = profiles?.anonymous?.handle;
  const accent = anonymous ? t.anonymous : t.known;

  async function send(confirmed: boolean) {
    const text = body.trim();
    if (text.length === 0 && photos.length === 0) {
      setError("Write something or add a photo.");
      return;
    }
    const altTexts: Record<string, string> = {};
    for (const p of photos) {
      const a = (alts[p.uploadId] ?? "").replace(/\s+/g, " ").trim();
      if (a.length > MAX_ALT_TEXT) {
        setError(`Photo descriptions can be at most ${MAX_ALT_TEXT} characters.`);
        return;
      }
      if (a.length > 0) altTexts[p.uploadId] = a;
    }
    setBusy(true);
    setError(null);
    try {
      const post = await api.createPost(
        {
          body: text,
          photoIds: photos.map((p) => p.uploadId),
          ...(Object.keys(altTexts).length > 0 ? { altTexts } : {}),
          ...(anonymous && confirmed ? { confirmedAnonymous: true } : {}),
        },
        as,
      );
      setNeedsConfirm(false);
      if (post.support) setPosted(post);
      else router.back();
    } catch (e) {
      if (isCode(e, "confirmation_required")) setNeedsConfirm(true);
      else setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function addPhotos() {
    setError(null);
    try {
      const added = await pickAndUpload(api, as, MAX_PHOTOS - photos.length);
      setPhotos((p) => [...p, ...added].slice(0, MAX_PHOTOS));
    } catch (e) {
      setError(
        e instanceof Error && e.message === "unsupported_image_type"
          ? "Use a JPEG, PNG or WebP photo."
          : describeError(e),
      );
    }
  }

  if (posted?.support) {
    return (
      <Screen>
        <Text variant="heading">Your post is up</Text>
        <SupportPanel support={posted.support} onDone={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View
        accessible
        accessibilityLabel={
          anonymous
            ? `You are posting anonymously as ${handle ?? "your anonymous profile"}`
            : "You are posting as yourself, with your name"
        }
        style={{
          borderWidth: 2,
          borderColor: accent,
          borderRadius: radius.lg,
          padding: spacing.md,
          gap: spacing.sm,
        }}
      >
        <ProfileChip kind={as} self prefix="Posting as" />
        <Text>
          {anonymous
            ? `Other students will see only ${handle ? "@" + handle : "your generated handle"}, not your name.`
            : "Other students at your campus will see your name."}
        </Text>
        {canUseAnonymous ? (
          <Button
            variant="secondary"
            label={anonymous ? "Post as yourself instead" : "Post anonymously instead"}
            onPress={() => {
              setAs(anonymous ? "known" : "anonymous");
              setNeedsConfirm(false);
              setPhotos([]);
              setAlts({});
            }}
            testID="switch-profile"
          />
        ) : null}
      </View>

      <TextField
        label="What do you want to say?"
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={MAX_POST_LENGTH}
        hint={`${body.length} / ${MAX_POST_LENGTH}`}
        testID="post-body"
      />

      {photos.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {photos.map((p, i) => (
            <View key={p.uploadId} style={{ gap: spacing.xs }}>
              <Image
                source={{ uri: p.localUri }}
                accessibilityLabel={`Selected photo ${i + 1} of ${photos.length}`}
                style={{ width: 96, height: 96, borderRadius: radius.md }}
              />
              <Button
                variant="link"
                label="Remove"
                accessibilityLabel={`Remove photo ${i + 1}`}
                onPress={() => {
                  setPhotos((all) => all.filter((x) => x.uploadId !== p.uploadId));
                  setAlts((a) => {
                    const { [p.uploadId]: _gone, ...rest } = a;
                    return rest;
                  });
                }}
              />
            </View>
          ))}
        </View>
      ) : null}
      {photos.map((p, i) => (
        <TextField
          key={p.uploadId}
          label={`Describe photo ${i + 1} (optional)`}
          hint={
            i === 0
              ? anonymous
                ? "Say what the photo shows, for people who use a screen reader. Do not include anything that could identify you."
                : "Say what the photo shows, for people who use a screen reader."
              : undefined
          }
          value={alts[p.uploadId] ?? ""}
          onChangeText={(v) => setAlts((a) => ({ ...a, [p.uploadId]: v }))}
          maxLength={MAX_ALT_TEXT}
          multiline
          testID={`alt-${i}`}
        />
      ))}
      <Button
        variant="secondary"
        label={photos.length >= MAX_PHOTOS ? "Photo limit reached" : `Add photos (${photos.length}/${MAX_PHOTOS})`}
        disabled={photos.length >= MAX_PHOTOS}
        onPress={addPhotos}
      />

      {needsConfirm ? (
        <Notice title="Post anonymously?">
          <Text>{ANONYMITY_NOTICE}</Text>
          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            <Button label="Yes, post anonymously" onPress={() => send(true)} busy={busy} testID="confirm-anonymous" />
            <Button variant="secondary" label="Cancel" onPress={() => setNeedsConfirm(false)} />
          </View>
        </Notice>
      ) : (
        <Button
          label={anonymous ? "Post anonymously" : "Post"}
          onPress={() => send(false)}
          busy={busy}
          testID="send-post"
        />
      )}

      {error ? (
        <Notice tone="error" title="Could not post">
          {error}
        </Notice>
      ) : null}
    </Screen>
  );
}
