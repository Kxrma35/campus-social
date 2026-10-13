import { parseArgs } from "node:util";
import pg from "pg";
import { BlindIndexer } from "../identity/linkCrypto.js";

const REASONS = [
  "confirmed_threat",
  "targeted_harassment",
  "intimate_image",
  "private_info_exposure",
  "court_order",
];

const { values } = parseArgs({
  options: {
    profile: { type: "string" },
    reason: { type: "string" },
    detail: { type: "string" },
    case: { type: "string" },
    "approved-by": { type: "string" },
    actor: { type: "string" },
  },
});

const url = process.env.TS_DATABASE_URL;
const blindKey = process.env.LINK_BLIND_INDEX_KEY;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!url) fail("TS_DATABASE_URL is required (your own trust_safety login).");
if (!blindKey) fail("LINK_BLIND_INDEX_KEY is required.");
if (!values.profile) fail("--profile <anonymous profile id> is required.");
if (!values.reason || !REASONS.includes(values.reason)) {
  fail(`--reason must be one of: ${REASONS.join(", ")}`);
}
if (!values.detail || values.detail.trim().length < 20) {
  fail("--detail must explain the justification in at least 20 characters.");
}
if (values.reason !== "court_order" && !values["approved-by"]) {
  fail("--approved-by is required for any reason other than court_order.");
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const actor =
    values.actor ?? (await pool.query(`select session_user as u`)).rows[0].u;
  const blindIndex = new BlindIndexer(blindKey).indexFor(values.profile);

  const r = await pool.query(
    `select * from identity.unmask_profile_identity($1, $2, $3, $4, $5, $6)`,
    [
      blindIndex,
      actor,
      values.reason,
      values.detail.trim(),
      values.case ?? null,
      values["approved-by"] ?? null,
    ],
  );

  if (r.rowCount === 0) {
    console.log("No account found for that profile. The attempt has been recorded.");
  } else {
    const row = r.rows[0];
    console.log("Lookup recorded. Handle this information under the unmasking policy.\n");
    console.log(`  email:        ${row.out_email}`);
    console.log(`  known name:   ${row.out_known_name ?? "(none)"}`);
    console.log(`  known handle: ${row.out_known_handle ?? "(none)"}`);
    console.log(`  status:       ${row.out_status}`);
  }
} catch (err) {
  const code = (err as { code?: string }).code;
  if (code === "TS001") {
    fail("Refused: a second, different approver is required for this reason.");
  }
  throw err;
} finally {
  await pool.end();
}
