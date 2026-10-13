import nodemailer from "nodemailer";
import { ApiError } from "../errors.js";
import type { CodePurpose } from "./store.js";

export interface Mailer {
  sendCode(to: string, code: string, purpose: CodePurpose, ttlMinutes: number): Promise<void>;
  sendAlreadyRegistered(to: string): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  constructor(
    private readonly write: (line: string) => void = (l) => console.log(l),
    nodeEnv: string | undefined = process.env.NODE_ENV,
  ) {
    if (nodeEnv === "production") {
      throw new Error("ConsoleMailer must not be used in production");
    }
  }

  async sendCode(to: string, code: string, purpose: CodePurpose, ttlMinutes: number) {
    this.write(`[mail:dev] ${purpose} code for ${to}: ${code} (expires in ${ttlMinutes} min)`);
  }

  async sendAlreadyRegistered(to: string) {
    this.write(`[mail:dev] ${to} already has an account; suggest logging in`);
  }
}

export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

const PURPOSE_TEXT: Record<CodePurpose, { subject: string; line: string }> = {
  signup: { subject: "Your Campus Social sign-up code", line: "Use this code to finish creating your account." },
  login: { subject: "Your Campus Social sign-in code", line: "Use this code to sign in." },
  reverify: { subject: "Your Campus Social verification code", line: "Use this code to confirm your student email address again." },
  close: { subject: "Confirm closing your Campus Social account", line: "Use this code to confirm that you want to close your account and delete your data." },
  appeal: { subject: "Your Campus Social appeal code", line: "Use this code to submit your appeal." },
};

export class SmtpMailer implements Mailer {
  constructor(
    private readonly transport: MailTransport,
    private readonly from: string,
  ) {}

  static fromUrl(smtpUrl: string, from: string, opts: { requireTls: boolean }): SmtpMailer {
    const url = new URL(smtpUrl);
    const secure = url.protocol === "smtps:";
    const transport = nodemailer.createTransport({
      host: url.hostname,
      port: Number(url.port) || (secure ? 465 : 587),
      secure,
      requireTLS: !secure && opts.requireTls,
      auth: url.username
        ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) }
        : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    return new SmtpMailer(transport, from);
  }

  async sendCode(to: string, code: string, purpose: CodePurpose, ttlMinutes: number) {
    const t = PURPOSE_TEXT[purpose];
    await this.send(
      to,
      t.subject,
      [
        t.line,
        "",
        `Your code: ${code}`,
        "",
        `It expires in ${ttlMinutes} minutes and works once.`,
        "If you did not ask for this, ignore this email. Nobody can use the code without your email account.",
        "Campus Social will never ask you for this code by message or phone.",
      ].join("\n"),
    );
  }

  async sendAlreadyRegistered(to: string) {
    await this.send(
      to,
      "Campus Social: you already have an account",
      [
        "Someone, probably you, tried to sign up with this email address, but it already has a Campus Social account.",
        "",
        "Open the app and choose sign in to get a code.",
        "If you did not do this, you can ignore this email.",
      ].join("\n"),
    );
  }

  private async send(to: string, subject: string, text: string) {
    try {
      await this.transport.sendMail({ from: this.from, to, subject, text });
    } catch (err) {
      const e = err as { code?: unknown; responseCode?: unknown };
      console.error(
        `[mail] delivery failed code=${String(e.code ?? "unknown")} response=${String(e.responseCode ?? "-")}`,
      );
      throw new ApiError(
        "email_unavailable",
        503,
        "We could not send the email right now. Please try again in a few minutes.",
      );
    }
  }
}
