import { router } from "expo-router";
import { useState } from "react";
import { useAuthFlow } from "@/core/authFlow";
import { describeError, isCode } from "@/core/lib/errors";
import { checkCourse, checkHandle, checkName, checkStudyYear } from "@/core/lib/validation";
import { useApi } from "@/core/session/SessionProvider";
import { AuthShell } from "@/ui/AuthShell";
import { Button } from "@/ui/Button";
import { InlineError } from "@/ui/InlineError";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

type Errors = Partial<Record<"name" | "handle" | "course" | "year", string>>;

export default function ProfileSetup() {
  const flow = useAuthFlow();
  const api = useApi();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [course, setCourse] = useState("");
  const [year, setYear] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!flow.email || !flow.code || !flow.dateOfBirth) {
    return (
      <AuthShell title="Let's start again" subtitle="Your sign up was interrupted. Enter your email again to get a new code.">
        <Button label="Start again" onPress={() => router.replace("/welcome")} testID="start-again" />
      </AuthShell>
    );
  }

  async function submit() {
    const next: Errors = {};
    const n = checkName(name);
    if (!n.ok) next.name = n.error;
    const h = checkHandle(handle);
    if (!h.ok) next.handle = h.error;
    const c = checkCourse(course);
    if (!c.ok) next.course = c.error;
    const y = checkStudyYear(year);
    if (!y.ok) next.year = y.error;
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0 || !n.value) return;

    setBusy(true);
    try {
      const session = await api.verifySignup({
        email: flow.email,
        code: flow.code,
        dateOfBirth: flow.dateOfBirth,
        displayName: n.value,
        handle: h.value ?? null,
        course: c.value ?? null,
        studyYear: y.value ?? null,
        confirmAge18: true,
        acceptTerms: true,
      });
      flow.setPendingSession(session);
      router.replace("/done");
    } catch (e) {
      if (isCode(e, "handle_taken") || isCode(e, "invalid_handle")) {
        setErrors({ handle: describeError(e) });
      } else if (isCode(e, "invalid_code") || isCode(e, "code_expired") || isCode(e, "too_many_attempts")) {
        flow.setNotice(describeError(e));
        flow.setCode("");
        router.dismissTo({ pathname: "/code", params: { mode: "signup" } });
      } else {
        setFormError(describeError(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Set up your profile"
      subtitle="Your name and course are shown to other students at your campus on your known profile."
    >
      <TextField label="Your name" value={name} onChangeText={setName} autoComplete="name"
        textContentType="name" error={errors.name} testID="name-input" />
      <TextField
        label="Handle (optional)"
        hint="3 to 20 letters, numbers or underscores. Leave blank and we will make one from your name."
        value={handle}
        onChangeText={setHandle}
        autoCapitalize="none"
        autoCorrect={false}
        error={errors.handle}
        testID="handle-input"
      />
      <TextField label="Course (optional)" value={course} onChangeText={setCourse}
        error={errors.course} testID="course-input" />
      <TextField label="Year of study (optional)" value={year} onChangeText={setYear}
        keyboardType="number-pad" maxLength={1} error={errors.year} testID="year-input" />
      {formError ? <InlineError testID="profile-error">{formError}</InlineError> : null}
      <Button label="Create my account" onPress={submit} busy={busy} testID="create-account" />
      <Text variant="caption" tone="muted" style={{ textAlign: "center" }}>
        You can add an anonymous profile later.
      </Text>
    </AuthShell>
  );
}
