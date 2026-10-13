import { timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { BlindIndexer, LinkCrypto } from "./linkCrypto.js";

export interface LinkRow {
  accountId: string;
  enc: Buffer;
  blind: Buffer;
  keyVersion: number;
}

export type LinkProblemKind = "cannot_decrypt" | "blind_index_mismatch" | "profile_missing";

export interface LinkProblem {
  accountId: string;
  problem: LinkProblemKind;
  detail?: string;
}

export interface LinkAnalysis {
  total: number;
  healthy: number;
  byBlobVersion: Record<number, number>;
  columnVersionDisagrees: number;
  problems: LinkProblem[];
}

const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

export async function analyzeLinks(
  rows: LinkRow[],
  crypto: LinkCrypto,
  profilesThatExist?: (ids: string[]) => Promise<Set<string>>,
): Promise<LinkAnalysis> {
  const byBlobVersion: Record<number, number> = {};
  const problems: LinkProblem[] = [];
  const decrypted = new Map<string, string>();
  let columnVersionDisagrees = 0;

  for (const row of rows) {
    const blobVersion = row.enc[0] ?? 0;
    byBlobVersion[blobVersion] = (byBlobVersion[blobVersion] ?? 0) + 1;
    if (blobVersion !== row.keyVersion) columnVersionDisagrees += 1;

    let profileId: string;
    try {
      profileId = crypto.decrypt(row.enc, row.accountId);
    } catch (err) {
      problems.push({
        accountId: row.accountId,
        problem: "cannot_decrypt",
        detail: err instanceof Error ? err.message : "unknown",
      });
      continue;
    }
    decrypted.set(row.accountId, profileId);

    if (!same(crypto.blindIndex(profileId), row.blind)) {
      problems.push({ accountId: row.accountId, problem: "blind_index_mismatch" });
    }
  }

  if (profilesThatExist && decrypted.size > 0) {
    const present = await profilesThatExist([...decrypted.values()]);
    for (const [accountId, profileId] of decrypted) {
      if (!present.has(profileId)) problems.push({ accountId, problem: "profile_missing" });
    }
  }

  return {
    total: rows.length,
    healthy: rows.length - new Set(problems.map((p) => p.accountId)).size,
    byBlobVersion,
    columnVersionDisagrees,
    problems,
  };
}

type Db = Pool | PoolClient;

export async function loadLinks(db: Db, lock = false): Promise<LinkRow[]> {
  const r = await db.query(
    `select account_id, anon_profile_enc, anon_blind_index, key_version
       from identity.anonymous_links order by account_id ${lock ? "for update" : ""}`,
  );
  return r.rows.map((row) => ({
    accountId: row.account_id as string,
    enc: row.anon_profile_enc as Buffer,
    blind: row.anon_blind_index as Buffer,
    keyVersion: row.key_version as number,
  }));
}

async function existingProfiles(db: Db, ids: string[]): Promise<Set<string>> {
  const r = await db.query(`select id from profiles where id = any($1::uuid[])`, [ids]);
  return new Set(r.rows.map((x) => x.id as string));
}

export async function verifyLinks(pool: Pool, crypto: LinkCrypto): Promise<LinkAnalysis> {
  const rows = await loadLinks(pool);
  return analyzeLinks(rows, crypto, (ids) => existingProfiles(pool, ids));
}

export interface RotationOutcome {
  /** True only when the changes were written and committed. */
  applied: boolean;
  /** Why nothing was written, when applied is false. */
  reason?: "dry_run" | "verification_failed" | "nothing_to_do";
  rowsChanged: number;
  reencrypted: number;
  reindexed: number;
  before: LinkAnalysis;
}

export async function rotateLinks(
  pool: Pool,
  opts: { crypto: LinkCrypto; apply: boolean; newBlind?: BlindIndexer },
): Promise<RotationOutcome> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const rows = await loadLinks(client, true);

    const before = await analyzeLinks(rows, opts.crypto);
    if (before.problems.length > 0) {
      await client.query("rollback");
      return {
        applied: false,
        reason: "verification_failed",
        rowsChanged: 0,
        reencrypted: 0,
        reindexed: 0,
        before,
      };
    }

    const latest = opts.crypto.latestKeyVersion;
    const updates: { accountId: string; enc: Buffer; blind: Buffer; version: number }[] = [];
    let reencrypted = 0;
    let reindexed = 0;

    for (const row of rows) {
      const profileId = opts.crypto.decrypt(row.enc, row.accountId);
      let enc = row.enc;
      let blind = row.blind;
      let version = row.enc[0] ?? row.keyVersion;
      let touched = false;

      if ((row.enc[0] ?? 0) !== latest) {
        const fresh = opts.crypto.encrypt(profileId, row.accountId);
        if (opts.crypto.decrypt(fresh.blob, row.accountId) !== profileId) {
          throw new Error("re-encryption did not round-trip; nothing was written");
        }
        enc = fresh.blob;
        version = fresh.keyVersion;
        reencrypted += 1;
        touched = true;
      }

      if (opts.newBlind) {
        const next = opts.newBlind.indexFor(profileId);
        if (!same(next, row.blind)) {
          blind = next;
          reindexed += 1;
          touched = true;
        }
      }

      if (touched || row.keyVersion !== version) {
        updates.push({ accountId: row.accountId, enc, blind, version });
      }
    }

    if (updates.length === 0) {
      await client.query("rollback");
      return { applied: false, reason: "nothing_to_do", rowsChanged: 0, reencrypted, reindexed, before };
    }
    if (!opts.apply) {
      await client.query("rollback");
      return {
        applied: false,
        reason: "dry_run",
        rowsChanged: updates.length,
        reencrypted,
        reindexed,
        before,
      };
    }

    for (const u of updates) {
      await client.query(
        `update identity.anonymous_links
            set anon_profile_enc = $2, anon_blind_index = $3, key_version = $4
          where account_id = $1`,
        [u.accountId, u.enc, u.blind, u.version],
      );
    }
    await client.query("commit");
    return {
      applied: true,
      rowsChanged: updates.length,
      reencrypted,
      reindexed,
      before,
    };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
