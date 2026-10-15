import nodemailer from "nodemailer";
import { ApiError } from "../errors.js";
import type { CodePurpose } from "./store.js";

export interface ReverifyReminder {
  kind: "due_soon" | "closing_soon";
  daysLeft: number;
  deadline: Date;
  graceDays: number;
  purgeDays: number;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatDeadline(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function reminderMessage(r: ReverifyReminder): { subject: string; text: string } {
  const date = formatDeadline(r.deadline);
  if (r.kind === "due_soon") {
    return {
      subject: `Moku: confirm your student email by ${date}`,
      text: [
        `Your Moku account needs to be re-verified by ${date}, which is in ${plural(r.daysLeft, "day")}.`,
        "",
        'To do it, open the app, go to Settings and choose "Confirm your email again". We will send a code to this address.',
        "",
        `If you do nothing, your account becomes read-only on ${date}: you can still sign in and read, but you cannot post or comment. If it is still not confirmed ${plural(r.graceDays, "day")} after that, the account is closed and your data is deleted about ${plural(r.purgeDays, "day")} later.`,
        "",
        "If you are leaving the university or no longer use this address, you can download your data from Settings, under Your data, before then.",
        "",
        "You are getting this email because you have a Moku account. You can ignore it if you no longer want one.",
      ].join("\n"),
    };
  }
  return {
    subject: `Moku: your account will close on ${date}`,
    text: [
      `Your Moku account is read-only because it was not re-verified. It will be closed on ${date}, which is in ${plural(r.daysLeft, "day")}, and your data is deleted about ${plural(r.purgeDays, "day")} after that.`,
      "",
      'To keep it, open the app, go to Settings and choose "Confirm your email (needed)". We will send a code to this address.',
      "",
      "To keep a copy of your data, download it from Settings, under Your data, before the account closes. If you no longer want the account, you do not need to do anything.",
    ].join("\n"),
  };
}

export interface Mailer {
  sendCode(to: string, code: string, purpose: CodePurpose, ttlMinutes: number): Promise<void>;
  sendReverifyReminder(to: string, reminder: ReverifyReminder): Promise<void>;
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

  async sendReverifyReminder(to: string, r: ReverifyReminder) {
    this.write(`[mail:dev] ${r.kind} reminder for ${to}: ${r.daysLeft} day(s) until ${formatDeadline(r.deadline)}`);
  }
}

export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

const PURPOSE_TEXT: Record<CodePurpose, { subject: string; line: string }> = {
  signup: { subject: "Your Moku sign-up code", line: "Use this code to finish creating your account." },
  login: { subject: "Your Moku sign-in code", line: "Use this code to sign in." },
  reverify: { subject: "Your Moku verification code", line: "Use this code to confirm your student email address again." },
  close: { subject: "Confirm closing your Moku account", line: "Use this code to confirm that you want to close your account and delete your data." },
  appeal: { subject: "Your Moku appeal code", line: "Use this code to submit your appeal." },
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
        "Moku will never ask you for this code by message or phone.",
      ].join("\n"),
    );
  }

  async sendAlreadyRegistered(to: string) {
    await this.send(
      to,
      "Moku: you already have an account",
      [
        "Someone, probably you, tried to sign up with this email address, but it already has a Moku account.",
        "",
        "Open the app and choose sign in to get a code.",
        "If you did not do this, you can ignore this email.",
      ].join("\n"),
    );
  }

  async sendReverifyReminder(to: string, reminder: ReverifyReminder) {
    const m = reminderMessage(reminder);
    await this.send(to, m.subject, m.text);
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
