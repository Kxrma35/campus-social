import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(here, "../../../db/migrations/0001_init.sql"),
  "utf8",
);

function tableBody(name: string): string {
  const re = new RegExp(`create table ${name} \\(([\\s\\S]*?)\\n\\);`, "i");
  const m = re.exec(sql);
  if (!m?.[1]) throw new Error(`table ${name} not found`);
  return m[1];
}

describe("anonymity: content tables never reference accounts", () => {
  const contentTables = [
    "profiles",
    "posts",
    "post_photos",
    "comments",
    "reactions",
    "follows",
    "notifications",
    "push_tokens",
  ];

  for (const table of contentTables) {
    it(`${table} has no account_id column or accounts reference`, () => {
      const body = tableBody(table);
      expect(body).not.toMatch(/account_id/i);
      expect(body).not.toMatch(/references accounts/i);
    });
  }
});

describe("identity isolation", () => {
  it("keeps the anonymous link in the identity schema", () => {
    expect(sql).toMatch(/create table identity\.anonymous_links/i);
    expect(sql).not.toMatch(/create table (public\.)?anonymous_links/i);
  });

  it("makes the unmask audit log append-only", () => {
    expect(sql).toMatch(/lookup_audit_no_update[\s\S]*before update or delete/i);
  });

  it("anonymous profiles carry no real name, course or year", () => {
    expect(sql).toMatch(/profiles_anon_no_realname/);
  });
});

describe("lifecycle migration (0003)", () => {
  const lifecycleSql = readFileSync(
    join(here, "../../../db/migrations/0003_lifecycle.sql"),
    "utf8",
  );

  it("allows a close code purpose", () => {
    expect(lifecycleSql).toMatch(/purpose in \('signup', 'login', 'reverify', 'close'\)/);
  });

  it("records banned emails so a ban blocks re-signup", () => {
    expect(lifecycleSql).toMatch(/insert into banned_emails/);
    expect(lifecycleSql).toMatch(/digest\(lower\(email::text\), 'sha256'\)/);
  });

  it("lets a purged account lose its date of birth", () => {
    expect(lifecycleSql).toMatch(/date_of_birth drop not null/);
  });

  it("withholds the blind index column from the service roles", () => {
    expect(lifecycleSql).toMatch(
      /grant select \(account_id, anon_profile_enc\) on identity\.anonymous_links/,
    );
    expect(lifecycleSql).not.toMatch(/select \([^)]*anon_blind_index[^)]*\)/);
  });

  it("gives the lifecycle role no rights over the audit log", () => {
    expect(lifecycleSql).not.toMatch(/lookup_audit/);
  });
});

describe("content migration (0004)", () => {
  const contentSql = readFileSync(
    join(here, "../../../db/migrations/0004_content.sql"),
    "utf8",
  );

  it("binds photo uploads to the uploading profile, not an account", () => {
    expect(contentSql).toMatch(/profile_id\s+uuid not null references profiles/);
    expect(contentSql).not.toMatch(/account_id/i);
  });

  it("gives app_api no delete rights and no access to accounts or identity", () => {
    const grants = contentSql
      .split("\n")
      .filter((l) => /^\s*grant\b/i.test(l))
      .join("\n");
    expect(grants).not.toMatch(/\bdelete\b/i);
    expect(grants).not.toMatch(/\baccounts\b/i);
    expect(grants).not.toMatch(/\bidentity\b/i);
  });
});

describe("limits from the spec", () => {
  it("allows at most 4 photos per post", () => {
    expect(sql).toMatch(/position between 0 and 3/);
  });

  it("limits each account to one appeal", () => {
    expect(tableBody("moderation\\.appeals")).toMatch(/account_id\s+uuid not null unique/);
  });
});
