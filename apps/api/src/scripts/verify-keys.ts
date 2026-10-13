import pg from "pg";
import { LinkCrypto } from "../identity/linkCrypto.js";
import { verifyLinks } from "../identity/rotation.js";

const url = process.env.KEY_CHECK_DATABASE_URL;
const encKeys = process.env.LINK_ENCRYPTION_KEYS;
const blindKey = process.env.LINK_BLIND_INDEX_KEY;

if (!url || !encKeys || !blindKey) {
  console.error(
    "KEY_CHECK_DATABASE_URL, LINK_ENCRYPTION_KEYS and LINK_BLIND_INDEX_KEY are all required.",
  );
  process.exit(2);
}

let crypto: LinkCrypto;
try {
  crypto = new LinkCrypto(encKeys, blindKey);
} catch (err) {
  console.error(`The keys themselves are not valid: ${(err as Error).message}`);
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const a = await verifyLinks(pool, crypto);

  console.log(`links checked:               ${a.total}`);
  console.log(`healthy:                     ${a.healthy}`);
  console.log(`problems:                    ${a.problems.length}`);
  for (const [version, n] of Object.entries(a.byBlobVersion).sort()) {
    console.log(`  encrypted under key v${version}:    ${n}`);
  }
  console.log(`key_version column disagrees: ${a.columnVersionDisagrees}`);
  console.log(`newest key version held:     v${crypto.latestKeyVersion}`);

  if (a.problems.length > 0) {
    console.log("\nproblems (account id, kind):");
    for (const p of a.problems.slice(0, 50)) {
      console.log(`  ${p.accountId}  ${p.problem}${p.detail ? `  (${p.detail})` : ""}`);
    }
    if (a.problems.length > 50) console.log(`  ... and ${a.problems.length - 50} more`);
    console.log("\nFAILED: do not rely on these keys. See ops/KEY_CUSTODY_AND_RESTORE.md.");
    process.exitCode = 1;
  } else {
    console.log("\nOK: every link opens with these keys.");
  }
} finally {
  await pool.end();
}
