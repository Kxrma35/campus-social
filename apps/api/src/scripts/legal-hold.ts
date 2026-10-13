import { parseArgs } from "node:util";
import pg from "pg";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KINDS = ["post", "comment", "profile"];

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "account-email": { type: "string" },
    target: { type: "string" },
    "audit-case": { type: "string" },
    reason: { type: "string" },
    by: { type: "string" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const url = process.env.LEGAL_HOLD_DATABASE_URL;
if (!url) fail("LEGAL_HOLD_DATABASE_URL is required (the database owner connection).");

const [command, holdId] = positionals;
if (!command || !["place", "release", "list"].includes(command)) {
  fail("usage: npm run legal-hold -- place|release|list ...");
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  if (command === "list") {
    const r = await pool.query(
      `select h.id, h.scope,
              coalesce(h.target_kind::text || ':' || h.target_id::text, h.case_ref, a.email::text) as covers,
              h.reason, h.placed_by, h.placed_at, h.released_at
         from moderation.legal_holds h
         left join accounts a on a.id = h.account_id
        order by h.placed_at desc`,
    );
    if (r.rowCount === 0) console.log("No holds.");
    for (const h of r.rows) {
      const state = h.released_at ? `released ${new Date(h.released_at).toISOString()}` : "ACTIVE";
      console.log(`${h.id}  ${state}  [${h.scope}] ${h.covers}\n    ${h.reason} (by ${h.placed_by})`);
    }
  } else if (command === "release") {
    if (!holdId || !UUID.test(holdId)) fail("release needs a hold id.");
    if (!values.by) fail("--by is required.");
    const r = await pool.query(
      `update moderation.legal_holds set released_at = now(), released_by = $2
        where id = $1 and released_at is null`,
      [holdId, values.by],
    );
    console.log(r.rowCount === 1 ? "Released." : "No active hold with that id.");
  } else {
    if (!values.reason || values.reason.trim().length < 10) {
      fail("--reason must say why, in at least 10 characters (for example the order reference).");
    }
    if (!values.by) fail("--by is required.");
    const given = [values["account-email"], values.target, values["audit-case"]].filter(Boolean);
    if (given.length !== 1) fail("Give exactly one of --account-email, --target, --audit-case.");

    let r;
    if (values["account-email"]) {
      r = await pool.query(
        `insert into moderation.legal_holds (scope, account_id, reason, placed_by)
         select 'account', id, $2, $3 from accounts where email = lower($1)
         returning id`,
        [values["account-email"], values.reason.trim(), values.by],
      );
      if (r.rowCount === 0) fail("No account with that email.");
    } else if (values.target) {
      const [kind, id] = values.target.split(":");
      if (!kind || !KINDS.includes(kind) || !id || !UUID.test(id)) {
        fail("--target must look like post:<uuid>, comment:<uuid> or profile:<uuid>.");
      }
      r = await pool.query(
        `insert into moderation.legal_holds (scope, target_kind, target_id, reason, placed_by)
         values ('target', $1::report_target, $2, $3, $4) returning id`,
        [kind, id, values.reason.trim(), values.by],
      );
    } else {
      r = await pool.query(
        `insert into moderation.legal_holds (scope, case_ref, reason, placed_by)
         values ('audit_case', $1, $2, $3) returning id`,
        [values["audit-case"], values.reason.trim(), values.by],
      );
    }
    console.log(`Hold placed: ${r.rows[0].id}`);
  }
} finally {
  await pool.end();
}
