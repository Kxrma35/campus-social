import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LinkCrypto } from "../src/identity/linkCrypto.js";
import { analyzeLinks, type LinkRow } from "../src/identity/rotation.js";
import { revokeSessions } from "../src/security/sessions.js";

const here = dirname(fileURLToPath(import.meta.url));
const b64 = () => randomBytes(32).toString("base64");

function makeRows(crypto: LinkCrypto, n: number): { rows: LinkRow[]; ids: Map<string, string> } {
  const rows: LinkRow[] = [];
  const ids = new Map<string, string>();
  for (let i = 0; i < n; i += 1) {
    const accountId = randomUUID();
    const profileId = randomUUID();
    const { blob, keyVersion } = crypto.encrypt(profileId, accountId);
    rows.push({ accountId, enc: blob, blind: crypto.blindIndex(profileId), keyVersion });
    ids.set(accountId, profileId);
  }
  return { rows, ids };
}

describe("analyzeLinks", () => {
  const k1 = b64();
  const blind = b64();

  it("reports every healthy link, counted by key version", async () => {
    const crypto = new LinkCrypto(`1:${k1}`, blind);
    const { rows } = makeRows(crypto, 5);
    const a = await analyzeLinks(rows, crypto);
    expect(a).toMatchObject({ total: 5, healthy: 5, byBlobVersion: { 1: 5 }, columnVersionDisagrees: 0 });
    expect(a.problems).toEqual([]);
  });

  it("separates old and new key versions", async () => {
    const k2 = b64();
    const old = new LinkCrypto(`1:${k1}`, blind);
    const both = new LinkCrypto(`1:${k1},2:${k2}`, blind);
    const a = makeRows(old, 3).rows;
    const b = makeRows(both, 2).rows;
    const out = await analyzeLinks([...a, ...b], both);
    expect(out.byBlobVersion).toEqual({ 1: 3, 2: 2 });
    expect(out.healthy).toBe(5);
  });

  it("flags a link the held keys cannot open, with a generic reason", async () => {
    const crypto = new LinkCrypto(`1:${k1}`, blind);
    const stranger = new LinkCrypto(`1:${b64()}`, blind);
    const { rows } = makeRows(stranger, 2);
    const a = await analyzeLinks(rows, crypto);
    expect(a.healthy).toBe(0);
    expect(a.problems.map((p) => p.problem)).toEqual(["cannot_decrypt", "cannot_decrypt"]);
  });

  it("says which key version is missing when only newer keys are held", async () => {
    const k2 = b64();
    const old = new LinkCrypto(`1:${k1}`, blind);
    const onlyNew = new LinkCrypto(`2:${k2}`, blind);
    const { rows } = makeRows(old, 1);
    const a = await analyzeLinks(rows, onlyNew);
    expect(a.problems[0]).toMatchObject({
      problem: "cannot_decrypt",
      detail: expect.stringMatching(/no link key for version 1/),
    });
  });

  it("flags a blob moved onto another account, and a tampered one", async () => {
    const crypto = new LinkCrypto(`1:${k1}`, blind);
    const { rows } = makeRows(crypto, 3);
    const swapped: LinkRow[] = [
      { ...rows[0]!, enc: rows[1]!.enc },
      { ...rows[1]!, enc: rows[0]!.enc },
      { ...rows[2]!, enc: Buffer.from(rows[2]!.enc.map((x, i) => (i === 20 ? x ^ 0xff : x))) },
    ];
    const a = await analyzeLinks(swapped, crypto);
    expect(a.problems.map((p) => p.problem)).toEqual([
      "cannot_decrypt",
      "cannot_decrypt",
      "cannot_decrypt",
    ]);
  });

  it("flags a blind index that no longer matches", async () => {
    const crypto = new LinkCrypto(`1:${k1}`, blind);
    const { rows } = makeRows(crypto, 2);
    const wrongKey = new LinkCrypto(`1:${k1}`, b64());
    const a = await analyzeLinks(rows, wrongKey);
    expect(a.problems.map((p) => p.problem)).toEqual(["blind_index_mismatch", "blind_index_mismatch"]);
  });

  it("flags a link whose profile no longer exists", async () => {
    const crypto = new LinkCrypto(`1:${k1}`, blind);
    const { rows, ids } = makeRows(crypto, 3);
    const keep = new Set([...ids.values()].slice(0, 2));
    const a = await analyzeLinks(rows, crypto, async () => keep);
    expect(a.problems).toEqual([{ accountId: rows[2]!.accountId, problem: "profile_missing" }]);
    expect(a.healthy).toBe(2);
  });

  it("notes a key_version column that disagrees with the blob", async () => {
    const crypto = new LinkCrypto(`1:${k1}`, blind);
    const { rows } = makeRows(crypto, 2);
    rows[0] = { ...rows[0]!, keyVersion: 9 };
    const a = await analyzeLinks(rows, crypto);
    expect(a.columnVersionDisagrees).toBe(1);
    expect(a.healthy).toBe(2);
  });

  it("never puts a decrypted profile id in its output", async () => {
    const crypto = new LinkCrypto(`1:${k1}`, blind);
    const { rows, ids } = makeRows(crypto, 4);
    rows[1] = { ...rows[1]!, blind: randomBytes(32) };
    const out = JSON.stringify(await analyzeLinks(rows, crypto, async () => new Set()));
    for (const id of ids.values()) expect(out).not.toContain(id);
  });
});

describe("revokeSessions argument rules", () => {
  function fakePool() {
    const calls: { sql: string; params: unknown[] }[] = [];
    return {
      calls,
      pool: {
        query: async (sql: string, params: unknown[]) => {
          calls.push({ sql, params });
          return { rowCount: 3 };
        },
      } as never,
    };
  }

  it("refuses to run with no scope, or with two", async () => {
    const f = fakePool();
    await expect(revokeSessions(f.pool, {})).rejects.toThrow(/exactly one/);
    await expect(
      revokeSessions(f.pool, { all: true, accountEmail: "a@test.ac.ke" }),
    ).rejects.toThrow(/exactly one/);
    expect(f.calls).toHaveLength(0);
  });

  it("revokes everything for --all, and only live sessions", async () => {
    const f = fakePool();
    expect(await revokeSessions(f.pool, { all: true })).toBe(3);
    expect(f.calls[0]!.sql).toMatch(/revoked_at is null/);
    expect(f.calls[0]!.sql).not.toMatch(/delete/i);
  });

  it("normalises the email and scopes to one account", async () => {
    const f = fakePool();
    await revokeSessions(f.pool, { accountEmail: "  Jane@Test.AC.KE " });
    expect(f.calls[0]!.params[1]).toBe("jane@test.ac.ke");
    expect(f.calls[0]!.sql).toMatch(/account_id = \(select id from accounts/);
  });
});

describe("operator commands never print secrets", () => {
  const src = (p: string) => readFileSync(join(here, "..", "src", p), "utf8");

  it("does not print decrypted profile ids or key material", () => {
    for (const f of ["scripts/verify-keys.ts", "scripts/rotate-keys.ts", "identity/rotation.ts"]) {
      const text = src(f);
      expect(text, f).not.toMatch(/console\.\w+\([^)]*profileId/);
      expect(text, f).not.toMatch(/console\.\w+\([^)]*(encKeys|blindKey|LINK_ENCRYPTION_KEYS\))/);
    }
  });

  it("rotation is a dry run unless apply is explicitly true", () => {
    const text = src("scripts/rotate-keys.ts");
    expect(text).toMatch(/apply: \{ type: "boolean", default: false \}/);
    expect(text).toMatch(/apply: values\.apply === true/);
  });
});
