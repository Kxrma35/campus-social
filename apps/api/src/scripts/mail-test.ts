// Proves that the configured email settings can reach a real mailbox.
//
//   SMTP_URL=... MAIL_FROM=... npm run mail-test -- someone@usiu.ac.ke
//
// It sends one harmless message with no code in it. It prints what the mail server said, never
// the credentials, and it reads only SMTP_URL and MAIL_FROM.
import { SmtpMailer } from "../auth/mailer.js";

const to = process.argv[2];
const smtp = process.env.SMTP_URL;
const from = process.env.MAIL_FROM;

if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
  console.error("usage: npm run mail-test -- recipient@example.org");
  process.exit(2);
}
if (!smtp || !from) {
  console.error("SMTP_URL and MAIL_FROM must both be set.");
  process.exit(2);
}

function explain(err: unknown): string {
  const e = err as { code?: unknown; responseCode?: unknown; cause?: { code?: unknown } };
  const code = String(e?.code ?? e?.cause?.code ?? "unknown");
  const smtpCode = e?.responseCode !== undefined ? ` (SMTP ${String(e.responseCode)})` : "";
  const hints: Record<string, string> = {
    EAUTH: "the mail server refused the username or password",
    ECONNECTION: "could not connect to the mail server",
    ETIMEDOUT: "the connection timed out; check the host, the port and any firewall",
    ESOCKET: "a connection or TLS problem; check the port matches smtps:// (465) or smtp:// (587)",
    EENVELOPE: "the sender or recipient address was refused",
    EMESSAGE: "the server rejected the message itself",
    ECONNREFUSED: "nothing is listening on that host and port",
    ENOTFOUND: "the mail server name does not exist",
  };
  return `${code}${smtpCode}: ${hints[code] ?? "see the provider's SMTP error list for this code"}`;
}

const mailer = SmtpMailer.fromUrl(smtp, from, { requireTls: true });

try {
  const r = await mailer.sendTest(to);
  if (r.rejected.length > 0) {
    console.error(`The server accepted the connection but rejected the recipient: ${r.rejected.join(", ")}`);
    process.exit(1);
  }
  console.log(`Accepted for ${r.accepted.join(", ") || to}. Server said: ${r.response || "(no text)"}`);
  console.log("Now check the mailbox, including junk and quarantine. 'Accepted' is not 'delivered'.");
} catch (err) {
  console.error(`Not sent: ${explain(err)}`);
  process.exit(1);
}
