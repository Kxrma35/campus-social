import { router, useLocalSearchParams } from "expo-router";
import { Button } from "@/ui/Button";
import { AuthShell } from "@/ui/AuthShell";
import { Notice } from "@/ui/Notice";

const TITLES: Record<string, string> = {
  terms: "Terms of service",
  privacy: "Privacy policy",
  rules: "Community rules",
};

export default function DraftDocument() {
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  const title = TITLES[slug ?? ""] ?? "Document";
  return (
    <AuthShell title={title} subtitle="DRAFT">
      <Notice title="Draft, not final">
        The text for this document has not been written or reviewed by a lawyer yet. It will be
        published here before the app opens to students.
      </Notice>
      <Button label="Back" variant="secondary" onPress={() => router.back()} testID="draft-back" />
    </AuthShell>
  );
}
