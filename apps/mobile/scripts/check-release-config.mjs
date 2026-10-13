import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = JSON.parse(readFileSync(join(root, "app.json"), "utf8")).expo;
const env = process.env.APP_ENV ?? process.env.EAS_BUILD_PROFILE ?? "";
const strict = env === "production";
const checked = env === "preview" || env === "production";

const problems = [];
const warn = [];

if (!checked) {
  console.log("No APP_ENV/EAS_BUILD_PROFILE set: nothing to check for a development run.");
  process.exit(0);
}

function needHttps(name, why) {
  const v = process.env[name];
  if (!v) return problems.push(`${name} is not set. ${why}`);
  let u;
  try {
    u = new URL(v);
  } catch {
    return problems.push(`${name} is not a valid URL: ${v}`);
  }
  if (u.protocol !== "https:") {
    problems.push(`${name} must be https:// (release Android builds block plain http). Got ${v}`);
  }
  if (/^(localhost|127\.|10\.|192\.168\.)/.test(u.hostname)) {
    problems.push(`${name} points at a private network address (${u.hostname}); testers outside that network cannot reach it.`);
  }
}

needHttps("EXPO_PUBLIC_API_BASE_URL", "Without it the app falls back to the emulator address and cannot reach the API.");
needHttps("EXPO_PUBLIC_LEGAL_BASE_URL", "Without it the app tells testers the policies are not published.");

const ids = [...new Set([app.android?.package, app.ios?.bundleIdentifier].filter(Boolean))];
if (ids.length === 0) problems.push("No Android package or iOS bundle identifier is set in app.json.");
for (const id of ids) {
  if (/\.dev$/.test(id) || /example/.test(id)) {
    (strict ? problems : warn).push(
      `Package id "${id}" is the development placeholder. It is permanent once published: replace it before production.`,
    );
  }
}

if (app.extra?.apiBaseUrl && /10\.0\.2\.2|localhost/.test(app.extra.apiBaseUrl)) {
  warn.push("app.json extra.apiBaseUrl is a development address; EXPO_PUBLIC_API_BASE_URL above takes precedence.");
}

for (const w of warn) console.warn("warning: " + w);
if (problems.length > 0) {
  console.error(`Release check failed for "${env}":\n  - ` + problems.join("\n  - "));
  process.exit(1);
}
console.log(`Release check passed for "${env}".`);
