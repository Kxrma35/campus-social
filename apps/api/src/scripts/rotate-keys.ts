import { parseArgs } from "node:util";
import pg from "pg";
import { BlindIndexer, LinkCrypto } from "../identity/linkCrypto.js";
import { rotateLinks } from "../identity/rotation.js";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    "new-blind-key-env": { type: "string" },
  },
});

const url = process.env.KEY_CHECK_DATABASE_URL;
const encKeys = process.env.LINK_ENCRYPTION_KEYS;
const blindKey = process.env.LINK_BLIND_INDEX_KEY;
if (!url || !encKeys || !blindKey) {
  console.error(
    "KEY_CHECK_DATABASE_URL, LINK_ENCRYPTION_KEYS and LINK_BLIND_INDEX_KEY are all required.",
  );
  process.exit(2);
}

let newBlind: BlindIndexer | undefined;
const newBlindEnv = values["new-blind-key-env"];
if (newBlindEnv) {
  const v = process.env[newBlindEnv];
  if (!v) {
    console.error(`${newBlindEnv} is not set.`);
    process.exit(2);
  }
  newBlind = new BlindIndexer(v);
}

const crypto = new LinkCrypto(encKeys, blindKey);
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const out = await rotateLinks(pool, { crypto, apply: values.apply === true, newBlind });

  console.log(`links:                        ${out.before.total}`);
  console.log(`newest key version:           v${crypto.latestKeyVersion}`);
  for (const [version, n] of Object.entries(out.before.byBlobVersion).sort()) {
    console.log(`  currently under v${version}:        ${n}`);
  }
  console.log(`to re-encrypt:                ${out.reencrypted}`);
  console.log(`to re-index (blind key):      ${out.reindexed}`);

  if (out.reason === "verification_failed") {
    console.log(`\nREFUSED: ${out.before.problems.length} link(s) did not verify. Nothing was written.`);
    for (const p of out.before.problems.slice(0, 20)) {
      console.log(`  ${p.accountId}  ${p.problem}${p.detail ? `  (${p.detail})` : ""}`);
    }
    process.exitCode = 1;
  } else if (out.reason === "nothing_to_do") {
    console.log("\nNothing to do: every link is already under the newest key.");
  } else if (out.reason === "dry_run") {
    console.log(`\nDRY RUN: ${out.rowsChanged} row(s) would change. Re-run with --apply to write.`);
  } else {
    console.log(`\nAPPLIED: ${out.rowsChanged} row(s) changed.`);
    console.log("Next: deploy the new keys to every process, then run `npm run verify-keys` with them.");
  }
} finally {
  await pool.end();
}
