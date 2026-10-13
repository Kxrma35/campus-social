import type { Pool } from "pg";

export async function revokeSessions(
  pool: Pool,
  opts: { all?: boolean; accountEmail?: string; now?: Date },
): Promise<number> {
  const now = opts.now ?? new Date();
  const given = [opts.all ? "all" : null, opts.accountEmail ? "email" : null].filter(Boolean);
  if (given.length !== 1) {
    throw new Error("give exactly one of: all, accountEmail");
  }

  if (opts.all) {
    const r = await pool.query(
      `update sessions set revoked_at = $1 where revoked_at is null`,
      [now],
    );
    return r.rowCount ?? 0;
  }

  const r = await pool.query(
    `update sessions set revoked_at = $1
      where revoked_at is null
        and account_id = (select id from accounts where email = $2)`,
    [now, opts.accountEmail!.trim().toLowerCase()],
  );
  return r.rowCount ?? 0;
}
