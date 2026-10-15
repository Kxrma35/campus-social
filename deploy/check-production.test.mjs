import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { check, parseEnv } from "./check-production.mjs";

const key = () => randomBytes(32).toString("base64");

function good() {
  const blind = key();
  return {
    api: {
      NODE_ENV: "production",
      DATABASE_URL: "postgres://auth_service:s3cret-a@db:5432/app",
      LIFECYCLE_DATABASE_URL: "postgres://account_lifecycle:s3cret-b@db:5432/app",
      CONTENT_DATABASE_URL: "postgres://app_api:s3cret-c@db:5432/app",
      CODE_HMAC_KEY: randomBytes(36).toString("base64"),
      LINK_ENCRYPTION_KEYS: `1:${key()}`,
      LINK_BLIND_INDEX_KEY: blind,
      SMTP_URL: "smtps://mailer:pw@smtp.mailhost.io:465",
      MAIL_FROM: "Moku <no-reply@moku.africa>",
      TERMS_VERSION: "2026-11-01",
      SUPPORT_RESOURCES_JSON: JSON.stringify([{ name: "Counselling", contact: "from the university" }]),
      TRUST_PROXY_HOPS: "1",
      PHOTO_STORAGE: "s3",
      S3_BUCKET: "moku-photos",
      S3_REGION: "eu-west-1",
    },
    admin: {
      NODE_ENV: "production",
      ADMIN_DATABASE_URL: "postgres://moderator:s3cret-d@db:5432/app",
      LINK_BLIND_INDEX_KEY: blind,
      PHOTO_STORAGE: "s3",
    },
  };
}

const problemsOf = (mutate, opts = {}) => {
  const c = good();
  mutate(c);
  return check({ ...c, ...opts }).problems.join("\n");
};

test("a complete, safe configuration passes with no problems", () => {
  const r = check(good());
  assert.deepEqual(r.problems, []);
});

test("the shipped example files are refused", async () => {
  const { readFileSync } = await import("node:fs");
  const api = parseEnv(readFileSync(new URL("./env.api.example", import.meta.url), "utf8"));
  const admin = parseEnv(readFileSync(new URL("./env.admin.example", import.meta.url), "utf8"));
  const r = check({ api, admin });
  assert.ok(r.problems.length >= 6, r.problems.join("\n"));
  assert.match(r.problems.join("\n"), /placeholder/);
});

test("secrets are never echoed back", () => {
  const c = good();
  c.api.CODE_HMAC_KEY = "short-secret-value";
  const text = check(c).problems.join("\n");
  assert.ok(!text.includes("short-secret-value"));
});

test("a development environment is refused", () => {
  assert.match(problemsOf((c) => (c.api.NODE_ENV = "development")), /NODE_ENV/);
  assert.match(problemsOf((c) => (c.api.DEV_CORS_ORIGIN = "http://localhost:8081")), /DEV_CORS_ORIGIN/);
  assert.match(problemsOf((c) => (c.api.ANON_MIN_ACCOUNT_AGE_DAYS = "0")), /ANON_MIN_ACCOUNT_AGE_DAYS/);
});

test("database logins must be the least powerful ones", () => {
  assert.match(
    problemsOf((c) => (c.api.DATABASE_URL = "postgres://postgres:pw@db:5432/app")),
    /DATABASE_URL should connect as "auth_service"/,
  );
  assert.match(
    problemsOf((c) => (c.admin.ADMIN_DATABASE_URL = "postgres://app_api:pw@db:5432/app")),
    /moderator/,
  );
});

test("a remote database needs TLS", () => {
  assert.match(
    problemsOf((c) => (c.api.CONTENT_DATABASE_URL = "postgres://app_api:pw@db.cloud.example:5432/app")),
    /sslmode/,
  );
  const ok = problemsOf((c) => {
    c.api.CONTENT_DATABASE_URL = "postgres://app_api:pw@db.cloud.io:5432/app?sslmode=require";
  });
  assert.doesNotMatch(ok, /sslmode/);
});

test("keys must be the right size and distinct", () => {
  assert.match(problemsOf((c) => (c.api.CODE_HMAC_KEY = "tooshort")), /at least 32/);
  assert.match(problemsOf((c) => (c.api.LINK_ENCRYPTION_KEYS = "1:abcd")), /32 bytes/);
  assert.match(
    problemsOf((c) => {
      const k = key();
      c.api.LINK_ENCRYPTION_KEYS = `1:${k}`;
      c.api.LINK_BLIND_INDEX_KEY = k;
      c.admin.LINK_BLIND_INDEX_KEY = k;
    }),
    /same key/,
  );
});

test("the admin service never holds the encryption key and shares the blind index key", () => {
  assert.match(problemsOf((c) => (c.admin.LINK_ENCRYPTION_KEYS = `1:${key()}`)), /never ever|only ever get the blind index key/);
  assert.match(problemsOf((c) => (c.admin.LINK_BLIND_INDEX_KEY = key())), /differs/);
  assert.match(problemsOf((c) => (c.admin.PHOTO_STORAGE = "local")), /PHOTO_STORAGE differs/);
});

test("email must be real", () => {
  assert.match(problemsOf((c) => delete c.api.SMTP_URL), /SMTP_URL is not set/);
  assert.match(problemsOf((c) => (c.api.SMTP_URL = "smtps://USER:PASSWORD@smtp.mailhost.io:465")), /example user or password/);
  assert.match(problemsOf((c) => (c.api.SMTP_URL = "smtps://u:p@smtp.example.com:465")), /example host/);
  assert.match(problemsOf((c) => (c.api.MAIL_FROM = "Moku <no-reply@example.org>")), /MAIL_FROM/);
});

test("the proxy must be declared so rate limits work", () => {
  assert.match(problemsOf((c) => delete c.api.TRUST_PROXY_HOPS), /TRUST_PROXY_HOPS/);
});

test("draft legal text and empty helplines block a launch but only warn in a closed test", () => {
  const draft = (c) => {
    c.api.TERMS_VERSION = "draft-0";
    c.api.SUPPORT_RESOURCES_JSON = "[]";
  };
  assert.match(problemsOf(draft), /TERMS_VERSION/);
  assert.match(problemsOf(draft), /SUPPORT_RESOURCES_JSON/);

  const c = good();
  draft(c);
  const r = check({ ...c, closedTest: true });
  assert.deepEqual(r.problems, []);
  assert.equal(r.warnings.filter((w) => /TERMS_VERSION|SUPPORT_RESOURCES_JSON/.test(w)).length, 2);
});

test("a helpline entry without a name or contact is refused", () => {
  assert.match(
    problemsOf((c) => (c.api.SUPPORT_RESOURCES_JSON = JSON.stringify([{ name: "Line", contact: "" }]))),
    /non-empty "name" and "contact"/,
  );
  assert.match(
    problemsOf((c) => (c.api.SUPPORT_RESOURCES_JSON = JSON.stringify([{ contact: "1192" }]))),
    /non-empty "name" and "contact"/,
  );
});

test("a closed test still refuses a security problem", () => {
  const c = good();
  c.api.NODE_ENV = "development";
  assert.ok(check({ ...c, closedTest: true }).problems.length > 0);
});

test("local photo storage is a warning, not a pass-through", () => {
  const c = good();
  c.api.PHOTO_STORAGE = "local";
  c.admin.PHOTO_STORAGE = "local";
  const r = check(c);
  assert.deepEqual(r.problems, []);
  assert.match(r.warnings.join("\n"), /one API instance/);
});

test("parseEnv handles comments, quotes and equals signs in values", () => {
  const env = parseEnv('# c\nA=1\nB="two words"\nC=postgres://u:p=q@h/db\n\n');
  assert.deepEqual(env, { A: "1", B: "two words", C: "postgres://u:p=q@h/db" });
});
