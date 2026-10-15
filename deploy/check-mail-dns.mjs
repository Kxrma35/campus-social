#!/usr/bin/env node
// Checks the DNS records that decide whether a mailbox provider trusts the sign-in codes you send.
// Microsoft 365 and Google Workspace both quarantine or reject mail from a domain that does not
// publish SPF, DKIM and DMARC, so check these before the first real send.
//
//   node deploy/check-mail-dns.mjs --from "Moku <no-reply@mail.example.org>" \
//        --dkim-selector s1 --dkim-selector s2 --recipient-domain usiu.ac.ke
//
// It only reads public DNS. It never sends mail.

import { promises as dns } from "node:dns";

const NO_RECORD = new Set(["ENOTFOUND", "ENODATA", "ENOENT"]);

async function safe(fn) {
  try {
    return await fn();
  } catch (e) {
    if (NO_RECORD.has(e?.code)) return [];
    throw e;
  }
}

export function domainOf(from) {
  const m = /@([^>\s]+)>?\s*$/.exec(from.trim());
  return m ? m[1].toLowerCase() : null;
}

/** Which mail system a domain's MX records point at, lowest preference first. */
export function classifyMx(records) {
  const sorted = [...records].sort((a, b) => a.priority - b.priority);
  const kind = (host) => {
    const h = host.toLowerCase().replace(/\.$/, "");
    if (h.endsWith("mail.protection.outlook.com")) return "Microsoft 365";
    if (/(^|\.)(google|googlemail)\.com$/.test(h)) return "Google Workspace";
    return "another provider";
  };
  return sorted.map((r) => ({ host: r.exchange, priority: r.priority, kind: kind(r.exchange) }));
}

/**
 * @param {{domain: string, selectors?: string[], recipientDomain?: string,
 *          resolver?: {resolveTxt: Function, resolveMx: Function, resolveCname: Function}}} input
 */
export async function checkMailDns({ domain, selectors = [], recipientDomain, resolver = dns }) {
  const problems = [];
  const warnings = [];
  const info = [];

  const txt = async (name) =>
    (await safe(() => resolver.resolveTxt(name))).map((chunks) => chunks.join(""));

  // SPF
  const spf = (await txt(domain)).filter((t) => /^v=spf1\b/i.test(t));
  if (spf.length === 0) {
    problems.push(`${domain} has no SPF record (a TXT starting "v=spf1"). Publish the one your email provider gives you.`);
  } else if (spf.length > 1) {
    problems.push(`${domain} has ${spf.length} SPF records. There must be exactly one; merge them.`);
  } else {
    const r = spf[0];
    if (/\s\+all\b|\s\?all\b/i.test(r)) {
      problems.push(`The SPF record for ${domain} ends in a pass-all or neutral rule, which protects nothing.`);
    } else if (!/\s[-~]all\s*$/i.test(r)) {
      warnings.push(`The SPF record for ${domain} does not end in -all or ~all.`);
    }
    if ((r.match(/\binclude:|\ba\b|\bmx\b|\bptr\b|\bexists:/gi) ?? []).length > 10) {
      warnings.push(`The SPF record for ${domain} may exceed the 10 DNS lookup limit.`);
    }
  }

  // DMARC
  const dmarc = (await txt(`_dmarc.${domain}`)).filter((t) => /^v=DMARC1\b/i.test(t));
  if (dmarc.length === 0) {
    problems.push(`${domain} has no DMARC record at _dmarc.${domain}. Start with "v=DMARC1; p=none; rua=mailto:<an address you read>".`);
  } else {
    const policy = /\bp=(\w+)/i.exec(dmarc[0])?.[1]?.toLowerCase();
    if (!policy || !["none", "quarantine", "reject"].includes(policy)) {
      problems.push(`The DMARC record for ${domain} has no valid p= policy.`);
    } else if (policy === "none") {
      warnings.push(`DMARC policy is p=none: fine while you are starting, but move to quarantine once reports show only your own mail.`);
    }
    if (!/\brua=/i.test(dmarc[0])) {
      warnings.push(`The DMARC record has no rua= address, so you will not see who is sending as ${domain}.`);
    }
  }

  // DKIM
  if (selectors.length === 0) {
    warnings.push("DKIM was not checked: pass the selector(s) your email provider gave you with --dkim-selector.");
  }
  for (const s of selectors) {
    const name = `${s}._domainkey.${domain}`;
    const t = (await txt(name)).filter((x) => /v=DKIM1|p=/i.test(x));
    const c = await safe(() => resolver.resolveCname(name));
    if (t.length === 0 && c.length === 0) {
      problems.push(`No DKIM key found at ${name}.`);
    } else if (t.length > 0 && /\bp=\s*(;|$)/i.test(t[0])) {
      problems.push(`The DKIM key at ${name} is empty, which means it has been revoked.`);
    }
  }

  // MX so bounces and replies have somewhere to go
  const mx = await safe(() => resolver.resolveMx(domain));
  if (mx.length === 0) {
    warnings.push(`${domain} has no MX record, so bounces and replies to its addresses will be lost.`);
  }

  if (recipientDomain) {
    const kinds = classifyMx(await safe(() => resolver.resolveMx(recipientDomain)));
    if (kinds.length === 0) {
      warnings.push(`${recipientDomain} has no MX records, so mail to it cannot be delivered.`);
    } else {
      info.push(
        `${recipientDomain} receives mail at: ` +
          kinds.map((k) => `${k.kind} (${k.host}, preference ${k.priority})`).join("; ") +
          ".",
      );
      if (kinds[0].kind === "Microsoft 365") {
        info.push(
          `Its first-choice mail system is Microsoft 365, which filters unknown senders strictly. Test delivery to a real mailbox and watch the junk and quarantine folders.`,
        );
      }
    }
  }

  return { problems, warnings, info };
}

async function main(argv) {
  const args = { selectors: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--from") args.from = argv[++i];
    else if (a === "--domain") args.domain = argv[++i];
    else if (a === "--dkim-selector") args.selectors.push(argv[++i]);
    else if (a === "--recipient-domain") args.recipientDomain = argv[++i];
    else {
      console.error(`unknown option: ${a}`);
      process.exit(2);
    }
  }
  const domain = args.domain ?? (args.from ? domainOf(args.from) : null);
  if (!domain) {
    console.error('usage: check-mail-dns.mjs --from "Moku <no-reply@your-domain>" [--dkim-selector S]... [--recipient-domain usiu.ac.ke]');
    process.exit(2);
  }
  const { problems, warnings, info } = await checkMailDns({
    domain,
    selectors: args.selectors,
    recipientDomain: args.recipientDomain,
  });
  for (const i of info) console.log(`info: ${i}`);
  for (const w of warnings) console.warn(`warning: ${w}`);
  if (problems.length > 0) {
    console.error(`Mail DNS check failed for ${domain} (${problems.length} problem${problems.length === 1 ? "" : "s"}):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`Mail DNS check passed for ${domain}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`DNS lookup failed: ${e?.code ?? e?.message ?? e}`);
    process.exit(1);
  });
}
