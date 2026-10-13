import { parseArgs } from "node:util";
import pg from "pg";
import { revokeSessions } from "../security/sessions.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    all: { type: "boolean", default: false },
    "account-email": { type: "string" },
  },
});

const url = process.env.LIFECYCLE_DATABASE_URL;
if (!url) {
  console.error("LIFECYCLE_DATABASE_URL is required.");
  process.exit(2);
}
if (positionals[0] !== "revoke-sessions") {
  console.error("usage: npm run security -- revoke-sessions (--all | --account-email <email>)");
  process.exit(2);
}
if ((values.all ? 1 : 0) + (values["account-email"] ? 1 : 0) !== 1) {
  console.error("Give exactly one of --all or --account-email.");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const n = await revokeSessions(pool, {
    all: values.all === true,
    accountEmail: values["account-email"],
  });
  console.log(`Revoked ${n} session(s).`);
} finally {
  await pool.end();
}
