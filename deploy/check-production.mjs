#!/usr/bin/env node
// Refuses a production deployment that still carries placeholders, development settings or
// unsafe defaults. It reads env files, never prints a secret value, and exits non-zero on
// any problem.
//
//   node deploy/check-production.mjs --api .env.api --admin .env.admin
//   node deploy/check-production.mjs --api .env.api --admin .env.admin --closed-test
//
// --closed-test turns the legal and helpline checks into warnings, for a small invited test
// before the documents are reviewed. It never relaxes a security check.

import { readFileSync } from "node:fs";

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const PLACEHOLDER = /CHANGE_ME|YOUR_PASSWORD|REPLACE_ME|<(your|change|replace|todo|password|key)[^>]*>|\bTODO\b/i;
const EXAMPLE_HOST = /(^|[@.])example\.(com|org|net)$/i;

function base64Bytes(value) {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  try {
    return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").length;
  } catch {
    return null;
  }
}

function dbUser(url) {
  try {
    return decodeURIComponent(new URL(url).username);
  } catch {
    return null;
  }
}

function dbHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isPrivateHost(host) {
  return (
    host === "db" ||
    host === "localhost" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/**
 * @param {{api: Record<string,string>, admin?: Record<string,string>, closedTest?: boolean}} input
 * @returns {{problems: string[], warnings: string[]}}
 */
export function check({ api, admin, closedTest = false }) {
  const problems = [];
  const warnings = [];
  const legal = (msg) => (closedTest ? warnings : problems).push(msg);

  const need = (env, name, where = "the API environment") => {
    const v = env[name];
    if (v === undefined || v === "") {
      problems.push(`${name} is not set in ${where}.`);
      return null;
    }
    if (PLACEHOLDER.test(v)) {
      problems.push(`${name} in ${where} still holds a placeholder.`);
      return null;
    }
    return v;
  };

  if (api.NODE_ENV !== "production") {
    problems.push(`NODE_ENV must be "production" (got "${api.NODE_ENV ?? ""}").`);
  }

  // Database logins: each service uses the least powerful login that works.
  const logins = [
    ["DATABASE_URL", "auth_service"],
    ["LIFECYCLE_DATABASE_URL", "account_lifecycle"],
    ["CONTENT_DATABASE_URL", "app_api"],
  ];
  for (const [name, role] of logins) {
    const url = need(api, name);
    if (!url) continue;
    const user = dbUser(url);
    if (user !== role) {
      problems.push(`${name} should connect as "${role}" (least privilege), not "${user ?? "?"}".`);
    }
    const host = dbHost(url);
    if (host && !isPrivateHost(host) && !/sslmode=(require|verify-ca|verify-full)/.test(url)) {
      problems.push(`${name} reaches a remote host (${host}) without sslmode=require or stronger.`);
    }
  }

  const hmac = need(api, "CODE_HMAC_KEY");
  if (hmac && hmac.length < 32) problems.push("CODE_HMAC_KEY must be at least 32 characters.");

  const enc = need(api, "LINK_ENCRYPTION_KEYS");
  if (enc) {
    for (const part of enc.split(",")) {
      const [version, key] = part.split(":");
      if (!/^\d+$/.test(version ?? "") || !key || base64Bytes(key) !== 32) {
        problems.push("LINK_ENCRYPTION_KEYS must be version:base64 pairs of 32 bytes each, for example 1:<key>.");
        break;
      }
    }
  }
  const blind = need(api, "LINK_BLIND_INDEX_KEY");
  if (blind && base64Bytes(blind) !== 32) {
    problems.push("LINK_BLIND_INDEX_KEY must be a base64 key of 32 bytes.");
  }
  if (enc && blind && enc.split(",").some((p) => p.split(":")[1] === blind)) {
    problems.push("LINK_BLIND_INDEX_KEY must not be the same key as an encryption key.");
  }

  // Email: production refuses to start without it, and codes must never be printed.
  const smtp = need(api, "SMTP_URL");
  if (smtp) {
    let u;
    try {
      u = new URL(smtp);
    } catch {
      problems.push("SMTP_URL is not a valid URL.");
    }
    if (u) {
      if (u.protocol !== "smtps:" && u.protocol !== "smtp:") problems.push("SMTP_URL must start with smtps:// or smtp://.");
      if (EXAMPLE_HOST.test(u.hostname)) problems.push("SMTP_URL still points at an example host.");
      if (decodeURIComponent(u.username) === "USER" || decodeURIComponent(u.password) === "PASSWORD") {
        problems.push("SMTP_URL still holds the example user or password.");
      }
      if (u.protocol === "smtp:" && u.port && u.port !== "587") {
        warnings.push("SMTP_URL uses smtp:// on a port other than 587; production requires STARTTLS.");
      }
    }
  }
  const from = need(api, "MAIL_FROM");
  if (from && /@example\.(com|org|net)\b/i.test(from)) {
    problems.push("MAIL_FROM still uses an example domain.");
  }

  // Network edge.
  const hops = Number(api.TRUST_PROXY_HOPS ?? "0");
  if (!(hops >= 1)) {
    problems.push("TRUST_PROXY_HOPS is not set. Set it to the number of proxies in front of the API so rate limits see each student's address.");
  }
  if (api.DEV_CORS_ORIGIN) problems.push("DEV_CORS_ORIGIN must not be set in production.");
  if (api.ANON_MIN_ACCOUNT_AGE_DAYS !== undefined && Number(api.ANON_MIN_ACCOUNT_AGE_DAYS) < 1) {
    problems.push("ANON_MIN_ACCOUNT_AGE_DAYS is 0, which removes the delay before anonymous posting. Use 3 or more.");
  }

  // Photos.
  if ((api.PHOTO_STORAGE ?? "local") === "local") {
    warnings.push("PHOTO_STORAGE is local: exactly one API instance, and the photo volume must be backed up with the database.");
  } else {
    for (const n of ["S3_BUCKET", "S3_REGION"]) need(api, n);
    if (Boolean(api.S3_ACCESS_KEY_ID) !== Boolean(api.S3_SECRET_ACCESS_KEY)) {
      problems.push("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together.");
    }
  }

  // Legal and safety content.
  if (/^draft/i.test(api.TERMS_VERSION ?? "draft-0")) {
    legal(`TERMS_VERSION is "${api.TERMS_VERSION ?? "draft-0"}": the terms have not been reviewed and issued.`);
  }
  let resources = [];
  try {
    resources = JSON.parse(api.SUPPORT_RESOURCES_JSON ?? "[]");
  } catch {
    problems.push("SUPPORT_RESOURCES_JSON is not valid JSON.");
  }
  if (!Array.isArray(resources) || resources.length === 0) {
    legal("SUPPORT_RESOURCES_JSON is empty: no confirmed counselling or helpline details will be shown after a flagged post.");
  } else if (
    resources.some(
      (r) => !r || typeof r.name !== "string" || !r.name.trim() || typeof r.contact !== "string" || !r.contact.trim(),
    )
  ) {
    problems.push('Every entry in SUPPORT_RESOURCES_JSON needs a non-empty "name" and "contact".');
  }

  // The admin service holds less: never the encryption key.
  if (admin) {
    const url = need(admin, "ADMIN_DATABASE_URL", "the admin environment");
    if (url && dbUser(url) !== "moderator") {
      problems.push(`ADMIN_DATABASE_URL should connect as "moderator", not "${dbUser(url) ?? "?"}".`);
    }
    if (admin.NODE_ENV !== "production") problems.push('NODE_ENV must be "production" in the admin environment.');
    if (admin.LINK_ENCRYPTION_KEYS) {
      problems.push("The admin environment holds LINK_ENCRYPTION_KEYS. It must only ever get the blind index key.");
    }
    const adminBlind = need(admin, "LINK_BLIND_INDEX_KEY", "the admin environment");
    if (adminBlind && blind && adminBlind !== blind) {
      problems.push("LINK_BLIND_INDEX_KEY differs between the API and admin environments.");
    }
    if ((admin.PHOTO_STORAGE ?? "local") !== (api.PHOTO_STORAGE ?? "local")) {
      problems.push("PHOTO_STORAGE differs between the API and admin environments; moderators would not see photos.");
    }
  } else {
    warnings.push("No admin environment was given, so the moderator service was not checked.");
  }

  return { problems, warnings };
}

function main(argv) {
  const args = { closedTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--api") args.api = argv[++i];
    else if (a === "--admin") args.admin = argv[++i];
    else if (a === "--closed-test") args.closedTest = true;
    else {
      console.error(`unknown option: ${a}`);
      process.exit(2);
    }
  }
  if (!args.api) {
    console.error("usage: check-production.mjs --api .env.api [--admin .env.admin] [--closed-test]");
    process.exit(2);
  }
  const api = parseEnv(readFileSync(args.api, "utf8"));
  const admin = args.admin ? parseEnv(readFileSync(args.admin, "utf8")) : undefined;
  const { problems, warnings } = check({ api, admin, closedTest: args.closedTest });

  for (const w of warnings) console.warn(`warning: ${w}`);
  if (problems.length > 0) {
    console.error(`Production check failed (${problems.length} problem${problems.length === 1 ? "" : "s"}):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`Production check passed${args.closedTest ? " for a closed test" : ""}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
