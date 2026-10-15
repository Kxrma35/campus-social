import { useEffect, useState } from "react";
import { View } from "react-native";
import { describeError } from "@/core/lib/errors";
import { checkCourse, checkName, checkStudyYear } from "@/core/lib/validation";
import { useSession } from "@/core/session/SessionProvider";
import { spacing } from "@/theme/tokens";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { InlineError } from "@/ui/InlineError";
import { ProfileChip } from "@/ui/ProfileChip";
import { Notice } from "@/ui/Notice";
import { SettingsPage } from "@/ui/SettingsPage";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

export default function EditProfile() {
  const { api } = useSession();
  const [name, setName] = useState("");
  const [course, setCourse] = useState("");
  const [year, setYear] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; course?: string; year?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .knownProfile()
      .then((p) => {
        if (!alive) return;
        setName(p.displayName);
        setCourse(p.course ?? "");
        setYear(p.studyYear ? String(p.studyYear) : "");
        setLoaded(true);
      })
      .catch((e) => alive && setFormError(describeError(e)));
    return () => {
      alive = false;
    };
  }, [api]);

  async function save() {
    const n = checkName(name);
    const c = checkCourse(course);
    const y = checkStudyYear(year);
    const next = { name: n.error, course: c.error, year: y.error };
    setErrors(next);
    setFormError(null);
    setSaved(false);
    if (!n.ok || !c.ok || !y.ok) return;

    setBusy(true);
    try {
      await api.updateKnownProfile({
        displayName: n.value,
        course: c.value ?? null,
        studyYear: y.value ?? null,
      });
      setSaved(true);
    } catch (e) {
      setFormError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPage>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <Avatar kind="known" name={name} size="lg" />
        <View style={{ flex: 1, gap: spacing.xs }}>
          <ProfileChip kind="known" self />
          <Text variant="small" tone="muted">
            Your name and course are shown to other students at your campus.
          </Text>
        </View>
      </View>
      <Text variant="small" tone="muted">
        If your handle was made from your name, it changes when you change your name. A handle you
        chose yourself stays as it is.
      </Text>
      <TextField label="Your name" value={name} onChangeText={setName} error={errors.name} testID="edit-name" />
      <TextField label="Course" value={course} onChangeText={setCourse} error={errors.course} testID="edit-course" />
      <TextField label="Year of study" value={year} onChangeText={setYear} keyboardType="number-pad"
        maxLength={1} error={errors.year} testID="edit-year" />
      {formError ? <InlineError>{formError}</InlineError> : null}
      {saved ? <Notice tone="success">Saved.</Notice> : null}
      <Button label="Save changes" onPress={save} busy={busy} disabled={!loaded} testID="save-profile" />
      <Notice title="Your email address and date of birth">
        These cannot be changed here, because they are how we know you are a current student aged 18
        or over. To correct either one, contact us using the details in the privacy policy.
      </Notice>
    </SettingsPage>
  );
}
