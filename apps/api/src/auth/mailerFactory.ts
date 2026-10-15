import type { Config } from "../config.js";
import { ConsoleMailer, SmtpMailer, type Mailer } from "./mailer.js";

export function createMailer(config: Config): Mailer | null {
  if (config.SMTP_URL && config.MAIL_FROM) {
    return SmtpMailer.fromUrl(config.SMTP_URL, config.MAIL_FROM, {
      requireTls: config.NODE_ENV === "production",
    });
  }
  if (config.NODE_ENV === "production") return null;
  return new ConsoleMailer(undefined, config.NODE_ENV);
}
