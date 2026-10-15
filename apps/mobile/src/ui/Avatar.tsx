import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { ProfileKind } from "@/core/api/types";
import { useOptionalApi } from "@/core/session/SessionProvider";
import { Text } from "./Text";
import { hiddenFromReaders } from "./a11y";
import { useTheme } from "./theme";

export type AvatarSize = "sm" | "md" | "lg" | "xl";
const PX: Record<AvatarSize, number> = { sm: 28, md: 40, lg: 56, xl: 80 };

export function initialOf(name: string | null | undefined): string {
  const t = (name ?? "").replace(/^@/, "").trim();
  return t ? t.charAt(0).toUpperCase() : "?";
}

export function Avatar({
  kind,
  name,
  size = "md",
  ringed = false,
  profileId,
  hasAvatar = false,
  cacheKey,
}: {
  kind: ProfileKind;
  name?: string | null;
  size?: AvatarSize;
  ringed?: boolean;
  /** With hasAvatar, shows the profile photo. Known profiles only. */
  profileId?: string;
  hasAvatar?: boolean;
  /** Changes when the photo changes, so a replaced photo is fetched again. */
  cacheKey?: string | number;
}) {
  const t = useTheme();
  const px = PX[size];
  const anon = kind === "anonymous";
  const api = useOptionalApi();
  const [broken, setBroken] = useState(false);
  const photo = !anon && hasAvatar && profileId && api && !broken
    ? api.photoRequest(`/profiles/${profileId}/avatar${cacheKey !== undefined ? `?v=${cacheKey}` : ""}`)
    : null;
  const ink = anon ? t.anonymous : t.known;

  return (
    <View
      {...hiddenFromReaders}
      style={[
        styles.disc,
        photo ? { overflow: "hidden" } : null,
        { width: px, height: px, borderRadius: Math.round(px * 0.32), backgroundColor: anon ? t.anonymousSoft : t.primarySoft },
        ringed ? { borderWidth: 3, borderColor: ink } : null,
      ]}
    >
      {photo ? (
        <Image
          testID="avatar-photo"
          source={photo}
          onError={() => setBroken(true)}
          style={{ width: px, height: px, borderRadius: Math.round(px * 0.32) }}
        />
      ) : anon ? (
        <Svg width={px * 0.62} height={px * 0.62} viewBox="0 0 24 24">
          <Circle cx="9" cy="12" r="5.5" fill="none" stroke={ink} strokeWidth={1.8} />
          <Circle cx="15" cy="12" r="5.5" fill="none" stroke={ink} strokeWidth={1.8} />
        </Svg>
      ) : (
        <Text
          style={{
            color: ink,
            fontSize: Math.round(px * 0.42),
            lineHeight: Math.round(px * 0.5),
            fontWeight: "700",
          }}
        >
          {initialOf(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  disc: { alignItems: "center", justifyContent: "center" },
});
