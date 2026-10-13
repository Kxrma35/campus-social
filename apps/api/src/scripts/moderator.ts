import { randomBytes } from "node:crypto";
import pg from "pg";
import { hashToken } from "../auth/crypto.js";

const [command, name] = process.argv.slice(2);
const url = process.env.MODERATOR_SETUP_DATABASE_URL;

if (!url || !name || (command !== "create" && command !== "revoke")) {
  console.error(
    'usage: MODERATOR_SETUP_DATABASE_URL=... npm run moderator -- create|revoke "<name>"',
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  if (command === "create") {
    const token = `mod_${randomBytes(32).toString("base64url")}`;
    await pool.query(
      `insert into moderation.moderators (name, token_hash) values ($1, $2)`,
      [name, hashToken(token)],
    );
    console.log(`Moderator "${name}" created. Token (shown once, store it safely):\n\n${token}\n`);
  } else {
    const r = await pool.query(
      `update moderation.moderators set active = false where name = $1 and active`,
      [name],
    );
    console.log(r.rowCount === 1 ? `Revoked "${name}".` : `No active moderator named "${name}".`);
  }
} finally {
  await pool.end();
}
