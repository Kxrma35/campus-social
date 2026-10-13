import { useEffect, useState } from "react";
import { describeError } from "@/core/lib/errors";
import { checkCourse, checkName, checkStudyYear } from "@/core/lib/validation";
import { useSession } from "@/core/session/SessionProvider";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
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
    <Screen>
      <Text tone="muted">
        This is your known profile. Your name and course are shown to other students at your campus.
        If you change your name, your @handle changes to match.
      </Text>
      <TextField label="Your name" value={name} onChangeText={setName} error={errors.name} testID="edit-name" />
      <TextField label="Course" value={course} onChangeText={setCourse} error={errors.course} testID="edit-course" />
      <TextField label="Year of study" value={year} onChangeText={setYear} keyboardType="number-pad"
        maxLength={1} error={errors.year} testID="edit-year" />
      {formError ? <Notice tone="error">{formError}</Notice> : null}
      {saved ? <Notice tone="success">Saved.</Notice> : null}
      <Button label="Save changes" onPress={save} busy={busy} disabled={!loaded} testID="save-profile" />
      <Notice title="Your email address and date of birth">
        These cannot be changed here, because they are how we know you are a current student aged 18
        or over. To correct either one, contact us using the details in the privacy policy.
      </Notice>
    </Screen>
  );
}
