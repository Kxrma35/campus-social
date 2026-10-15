import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import type { SignupInput } from "@/core/api/types";
import { useAuthFlow } from "@/core/authFlow";
import { legalBaseUrl } from "@/core/config";
import { describeError, isCode } from "@/core/lib/errors";
import {
  checkCourse,
  checkDateOfBirth,
  checkName,
  checkStudyYear,
  isAtLeast18,
} from "@/core/lib/validation";
import { useSession } from "@/core/session/SessionProvider";
import { spacing } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { LegalLinks } from "@/ui/LegalLinks";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

type FieldErrors = Partial<Record<"name" | "course" | "year" | "dob" | "age" | "terms", string>>;

export default function DetailsScreen() {
  const { email, code } = useAuthFlow();
  const { api, signIn } = useSession();

  const [name, setName] = useState("");
  const [course, setCourse] = useState("");
  const [year, setYear] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [yearOfBirth, setYearOfBirth] = useState("");
  const [over18, setOver18] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [needsNewCode, setNeedsNewCode] = useState(false);
  const [busy, setBusy] = useState(false);

  const policiesReadable = legalBaseUrl() !== null || __DEV__;

  async function submit() {
    const next: FieldErrors = {};
    const n = checkName(name);
    if (!n.ok) next.name = n.error;
    const c = checkCourse(course);
    if (!c.ok) next.course = c.error;
    const y = checkStudyYear(year);
    if (!y.ok) next.year = y.error;
    const dob = checkDateOfBirth(day, month, yearOfBirth);
    if (!dob.ok) next.dob = dob.error;
    else if (dob.value && !isAtLeast18(dob.value)) next.age = "You must be 18 or older to use Campus Social.";
    if (!over18) next.age = next.age ?? "Confirm that you are 18 or older.";
    if (!accepted) next.terms = "Agree to the terms to continue.";

    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0 || !n.value || !dob.value) return;

    const input: SignupInput = {
      email,
      code,
      dateOfBirth: dob.value,
      displayName: n.value,
      course: c.value ?? null,
      studyYear: y.value ?? null,
      confirmAge18: true,
      acceptTerms: true,
    };

    setBusy(true);
    try {
      await signIn(await api.verifySignup(input));
    } catch (e) {
      if (isCode(e, "invalid_code") || isCode(e, "code_expired") || isCode(e, "too_many_attempts")) {
        setNeedsNewCode(true);
      }
      setFormError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!email || !code) {
    return (
      <Screen>
        <Notice title="Let's start again">
          Your sign up was interrupted, for example by reloading the page. Enter your email address
          again to get a new code.
        </Notice>
        <Button label="Start again" onPress={() => router.replace("/welcome")} testID="start-again" />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text tone="muted">
        Your name and course are shown to other students at your campus on your known profile. You
        can add an anonymous profile later.
      </Text>

      <TextField label="Your name" value={name} onChangeText={setName} autoComplete="name"
        textContentType="name" error={errors.name} testID="name-input" />
      <TextField label="Course (optional)" value={course} onChangeText={setCourse}
        error={errors.course} testID="course-input" />
      <TextField label="Year of study (optional)" value={year} onChangeText={setYear}
        keyboardType="number-pad" maxLength={1} error={errors.year} testID="year-input" />

      <View style={{ gap: spacing.xs }}>
        <Text variant="label">Date of birth</Text>
        <Text variant="small" tone="muted">
          Used once, to check you are 18 or older.
        </Text>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <TextField label="Day" value={day} onChangeText={setDay} keyboardType="number-pad" maxLength={2} testID="dob-day" />
          </View>
          <View style={{ flex: 1 }}>
            <TextField label="Month" value={month} onChangeText={setMonth} keyboardType="number-pad" maxLength={2} testID="dob-month" />
          </View>
          <View style={{ flex: 1.4 }}>
            <TextField label="Year" value={yearOfBirth} onChangeText={setYearOfBirth} keyboardType="number-pad" maxLength={4} testID="dob-year" />
          </View>
        </View>
        {errors.dob ? <Text variant="small" tone="danger" accessibilityRole="alert">{errors.dob}</Text> : null}
      </View>

      <View style={{ gap: spacing.md }}>
        <Checkbox
          testID="over18"
          checked={over18}
          onChange={setOver18}
          label="I confirm that I am 18 years old or older"
        />
        {errors.age ? <Text variant="small" tone="danger" accessibilityRole="alert">{errors.age}</Text> : null}

        <Checkbox
          testID="accept-terms"
          checked={accepted}
          onChange={setAccepted}
          label="I have read and agree to the terms of service, privacy policy and community rules"
        />
        {errors.terms ? <Text variant="small" tone="danger" accessibilityRole="alert">{errors.terms}</Text> : null}
        <LegalLinks slugs={["terms", "privacy", "rules"]} />
        {!policiesReadable ? (
          <Notice tone="error" title="Cannot sign up yet">
            This build has no published policies to agree to.
          </Notice>
        ) : null}
      </View>

      {formError ? (
        <Notice tone="error" title="Could not create your account">
          {formError}
        </Notice>
      ) : null}
      {needsNewCode ? (
        <Button variant="secondary" label="Request a new code" onPress={() => router.dismissAll()} />
      ) : null}

      <Button label="Create my account" onPress={submit} busy={busy} disabled={!policiesReadable} testID="create-account" />
    </Screen>
  );
}
