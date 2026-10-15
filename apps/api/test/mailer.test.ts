import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/errors.js";
import { SmtpMailer } from "../src/auth/mailer.js";
import type { CodePurpose } from "../src/auth/store.js";

function fake(fail?: unknown) {
  const sent: { from: string; to: string; subject: string; text: string }[] = [];
  return {
    sent,
    transport: {
      sendMail: async (m: (typeof sent)[number]) => {
        if (fail) throw fail;
        sent.push(m);
      },
    },
  };
}

describe("SmtpMailer", () => {
  const purposes: CodePurpose[] = ["signup", "login", "reverify", "close", "appeal"];

  it.each(purposes)("sends a %s code as plain text with no links", async (purpose) => {
    const f = fake();
    await new SmtpMailer(f.transport, "Moku <no-reply@example.test>").sendCode(
      "jane@usiu.ac.ke",
      "123456",
      purpose,
      10,
    );
    const m = f.sent[0]!;
    expect(m.to).toBe("jane@usiu.ac.ke");
    expect(m.text).toContain("123456");
    expect(m.text).toContain("10 minutes");
    expect(m.subject).not.toContain("123456");
    expect(m.text).not.toMatch(/https?:\/\//i);
    expect(m.text).not.toMatch(/<[a-z][^>]*>/i);
  });

  it("tells an existing account holder to sign in, without a code", async () => {
    const f = fake();
    await new SmtpMailer(f.transport, "no-reply@example.test").sendAlreadyRegistered("jane@usiu.ac.ke");
    expect(f.sent[0]!.text).toMatch(/already has a Moku account/);
    expect(f.sent[0]!.text).not.toMatch(/\b\d{6}\b/);
  });

  it("turns any delivery failure into one generic 503 that leaks nothing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const err = Object.assign(new Error("550 jane@usiu.ac.ke rejected, code 123456"), {
      code: "EENVELOPE",
      responseCode: 550,
    });
    const m = new SmtpMailer(fake(err).transport, "no-reply@example.test");

    for (const send of [
      () => m.sendCode("jane@usiu.ac.ke", "123456", "signup", 10),
      () => m.sendAlreadyRegistered("jane@usiu.ac.ke"),
    ]) {
      const e = await send().then(
        () => null,
        (x: unknown) => x,
      );
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).httpStatus).toBe(503);
      expect((e as ApiError).code).toBe("email_unavailable");
      expect((e as ApiError).message).not.toMatch(/usiu|123456/);
    }

    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("EENVELOPE");
    expect(logged).not.toMatch(/usiu|123456/);
    spy.mockRestore();
  });
});
