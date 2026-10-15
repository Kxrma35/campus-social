import { router } from "expo-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  PixelRatio,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HERO_SLIDES } from "@/core/heroSlides";
import { spacing } from "@/theme/tokens";
import { HeroPanel } from "./HeroPanel";
import { Logomark } from "./Logomark";
import { Text } from "./Text";
import { useTheme } from "./theme";

const WIDE = 600;

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  showBack = true,
  onBack,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  showBack?: boolean;
  onBack?: () => void;
}) {
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  const [keyboardUp, setKeyboardUp] = useState(false);
  const wide = width >= WIDE;
  const bigText = PixelRatio.getFontScale() > 1.5;

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardUp(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const back = showBack ? (onBack ?? (router.canGoBack() ? () => router.back() : undefined)) : undefined;
  const compact = keyboardUp || bigText;
  const heroHeight = bigText ? 96 : keyboardUp ? Math.round(height * 0.18) : Math.max(220, Math.round(height * 0.45));

  const form = (
    <View style={[styles.form, wide && styles.formWide]}>
      <View style={styles.head}>
        <Logomark />
        <Text variant="title" style={styles.center}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" tone="muted" style={styles.center}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.fields}>{children}</View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: t.background }]} edges={["top", "left", "right", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {wide ? (
          <View style={styles.split}>
            <ScrollView style={styles.splitForm} contentContainerStyle={styles.grow} keyboardShouldPersistTaps="handled">
              {form}
            </ScrollView>
            <View style={styles.splitHero}>
              <HeroPanel slides={HERO_SLIDES} onBack={back} />
            </View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.grow} keyboardShouldPersistTaps="handled">
            <View style={styles.heroWrap}>
              <HeroPanel slides={HERO_SLIDES} height={heroHeight} compact={compact} onBack={back} />
            </View>
            {form}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
  heroWrap: { padding: spacing.md },
  form: { flexGrow: 1, padding: spacing.xl, gap: spacing.xl },
  formWide: { maxWidth: 420, width: "100%", alignSelf: "center", justifyContent: "center", padding: spacing.xxl },
  head: { alignItems: "center", gap: spacing.sm },
  center: { textAlign: "center" },
  fields: { gap: spacing.lg },
  footer: { marginTop: "auto", alignItems: "center", gap: spacing.sm },
  split: { flex: 1, flexDirection: "row" },
  splitForm: { flexGrow: 45, flexShrink: 1, flexBasis: 0, minWidth: 360 },
  splitHero: { flexGrow: 55, flexShrink: 1, flexBasis: 0, minWidth: 0, padding: spacing.md },
});
