import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/errors.js";
import { SmtpMailer } from "../src/auth/mailer.js";
import type { CodePurpose } from "../src/auth/store.js";

function fake(fail?: unknown) {
  const sent: { from: string; to: string; subject: string; text: string; headers?: Record<string, string> }[] = [];
  return {
    sent,
    transport: {
      sendMail: async (m: (typeof sent)[number]) => {
        if (fail) throw fail;
        sent.push(m);
        return { accepted: [m.to], rejected: [], response: "250 2.0.0 queued" };
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

describe("SmtpMailer delivery hints", () => {
  it("marks every message as automated so receiving systems do not auto-reply", async () => {
    const f = fake();
    const mailer = new SmtpMailer(f.transport, "Moku <no-reply@example.test>");
    await mailer.sendCode("jane@usiu.ac.ke", "123456", "login", 10);
    await mailer.sendAlreadyRegistered("jane@usiu.ac.ke");
    for (const m of f.sent) {
      expect(m.headers?.["Auto-Submitted"]).toBe("auto-generated");
      expect(m.headers?.["X-Auto-Response-Suppress"]).toBe("All");
    }
  });

  it("sends a test message with no code and reports what the server said", async () => {
    const f = fake();
    const r = await new SmtpMailer(f.transport, "Moku <no-reply@example.test>").sendTest(
      "jane@usiu.ac.ke",
      new Date("2026-10-15T12:00:00Z"),
    );
    expect(r).toEqual({ accepted: ["jane@usiu.ac.ke"], rejected: [], response: "250 2.0.0 queued" });
    const m = f.sent[0]!;
    expect(m.subject).toBe("Moku email test");
    expect(m.text).not.toMatch(/\b\d{6}\b/);
    expect(m.text).toContain("2026-10-15T12:00:00.000Z");
  });

  it("reports a rejected recipient instead of pretending it was sent", async () => {
    const transport = {
      sendMail: async () => ({ accepted: [], rejected: ["jane@usiu.ac.ke"], response: "550 no such user" }),
    };
    const r = await new SmtpMailer(transport, "no-reply@example.test").sendTest("jane@usiu.ac.ke");
    expect(r.rejected).toEqual(["jane@usiu.ac.ke"]);
    expect(r.accepted).toEqual([]);
  });
});
