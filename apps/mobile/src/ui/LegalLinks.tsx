import { Linking, View } from "react-native";
import { LEGAL_DOCUMENTS, legalBaseUrl } from "@/core/config";
import type { LegalSlug } from "@/core/config";
import { spacing } from "@/theme/tokens";
import { Button } from "./Button";
import { Notice } from "./Notice";

export function openLegal(slug: LegalSlug): boolean {
  const base = legalBaseUrl();
  if (!base) return false;
  void Linking.openURL(`${base}/${slug}`);
  return true;
}

export function LegalLinks({ slugs }: { slugs?: LegalSlug[] }) {
  const base = legalBaseUrl();
  const docs = LEGAL_DOCUMENTS.filter((d) => !slugs || slugs.includes(d.slug));

  if (!base) {
    return (
      <Notice title="Policies not published yet" tone="info">
        The privacy policy, terms and community rules have not been published for this build, so
        they cannot be shown here yet.
      </Notice>
    );
  }
  return (
    <View style={{ gap: spacing.xs }}>
      {docs.map((d) => (
        <Button
          key={d.slug}
          variant="link"
          label={d.title}
          accessibilityHint="Opens in your browser"
          onPress={() => openLegal(d.slug)}
        />
      ))}
    </View>
  );
}
