import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgAuthStore } from "../src/auth/pgStore.js";
import { AuthService } from "../src/auth/service.js";
import { LinkCrypto } from "../src/identity/linkCrypto.js";
import { DEFAULT_IDENTITY_OPTIONS, IdentityService } from "../src/identity/service.js";
import { CapturingMailer } from "./helpers/memoryStore.js";

const password = process.env.TEST_PG_PASSWORD;
const host = process.env.TEST_PG_HOST ?? "127.0.0.1";
const port = Number(process.env.TEST_PG_PORT ?? 5432);
const database = process.env.TEST_PG_DB ?? "campus_social";

const have = (cmd: string) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;
const ready = Boolean(password) && have("docker") && have("gpg") && have("bash");
const suite = ready ? describe : describe.skip;

const root = join(__dirname, "../../..");
const script = (rel: string) => join(root, rel);
const MARKER = "marker-post-body-7f3a9c";
const RECIPIENT = "backup-test@example.test";
const b64 = () => randomBytes(32).toString("base64");

function run(file: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("bash", [script(file), ...args], {
    env: { ...process.env, PG_TOOLS: "docker", ...env },
    encoding: "utf8",
    timeout: 180_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

suite("Backup, restore and the restore drill (PostgreSQL, Docker, gpg)", () => {
  let owner: pg.Pool;
  let work: string;
  let gnupg: string;
  let ownerUrl: string;
  const encKeys = `1:${b64()}`;
  const blindKey = b64();
  const restoreDb = "restore_check";
  const urlFor = (db: string) => `postgres://postgres:${password}@${host}:${port}/${db}`;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), "campus-backup-"));
    gnupg = join(work, "gnupg");
    execFileSync("mkdir", ["-m", "700", gnupg]);
    execFileSync(
      "gpg",
      ["--batch", "--passphrase", "", "--quick-generate-key", RECIPIENT, "default", "default", "never"],
      { env: { ...process.env, GNUPGHOME: gnupg }, stdio: "ignore" },
    );

    owner = new pg.Pool({ host, port, database, user: "postgres", password, max: 2 });
    ownerUrl = urlFor(database);
    await owner.query(
      `truncate accounts, profiles, email_codes, sessions, banned_emails, universities,
                photo_uploads, notifications, storage_deletions cascade`,
    );
    await owner.query(
      `insert into universities (name, email_domain, active) values ('One', 'test.ac.ke', true)`,
    );

    const authPool = new pg.Pool({ host, port, database, user: "auth_service", password, max: 2 });
    const mailer = new CapturingMailer();
    const clock = { now: new Date("2026-10-12T10:00:00Z") };
    const store = new PgAuthStore(authPool);
    const auth = new AuthService(
      store,
      mailer,
      {
        codeHmacKey: "backup-key-backup-key-backup-key-0123456789",
        codeTtlMinutes: 10,
        maxCodesPerHour: 50,
        maxCodeAttempts: 3,
        sessionTtlDays: 400,
        termsVersion: "t",
      },
      () => clock.now,
    );
    const identity = new IdentityService(
      auth,
      store,
      new LinkCrypto(encKeys, blindKey),
      { ...DEFAULT_IDENTITY_OPTIONS, minAccountAgeDays: 0 },
      () => clock.now,
    );
    for (const name of ["alice", "bob"]) {
      const email = `${name}@test.ac.ke`;
      await auth.requestSignup(email);
      const s = await auth.verifySignup({
        email,
        code: mailer.lastCode(email),
        dateOfBirth: "2004-05-01",
        displayName: `${name} Student`,
      });
      const made = await identity.createAnonymous(s.sessionToken, { acknowledged: true });
      await owner.query(`insert into posts (author_profile_id, body) values ($1, $2)`, [
        made.profile.profileId,
        MARKER,
      ]);
    }
    await authPool.end();
  }, 120_000);

  afterAll(async () => {
    await owner?.query(`drop database if exists ${restoreDb}`);
    await owner?.end();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  let encFile = "";
  let manifestFile = "";

  it("refuses to take a backup without a decision about encryption", () => {
    const r = run("deploy/backup.sh", ["--out", join(work, "none")], { OWNER_DATABASE_URL: ownerUrl });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/--encrypt-to/);
    expect(existsSync(join(work, "none"))).toBe(false);
  });

  it("writes an encrypted backup, with a manifest that holds no key", () => {
    const dir = join(work, "enc");
    const r = run("deploy/backup.sh", ["--out", dir, "--encrypt-to", RECIPIENT], {
      OWNER_DATABASE_URL: ownerUrl,
      GNUPGHOME: gnupg,
    });
    expect(r.out).toContain("backup written");
    expect(r.status).toBe(0);

    const files = readdirSync(dir);
    encFile = join(dir, files.find((f) => f.endsWith(".dump.gpg"))!);
    manifestFile = join(dir, files.find((f) => f.endsWith(".manifest.txt"))!);
    expect(files.some((f) => f.endsWith(".partial"))).toBe(false);

    const head = readFileSync(encFile).subarray(0, 5).toString("latin1");
    expect(head).not.toBe("PGDMP");

    const manifest = readFileSync(manifestFile, "utf8");
    expect(manifest).toContain("encrypted: yes");
    expect(manifest).toContain("rows_accounts: 2");
    expect(manifest).toContain("rows_anonymous_links: 2");
    expect(manifest).toContain("keys_included: no");
    expect(manifest).not.toContain(encKeys.split(":")[1]!);
    expect(manifest).not.toContain(blindKey);
  }, 180_000);

  it("refuses to restore without an explicit overwrite, or onto the live database", () => {
    const noConfirm = run("deploy/restore.sh", ["--backup", encFile, "--target-url", urlFor(restoreDb)], {
      GNUPGHOME: gnupg,
    });
    expect(noConfirm.status).not.toBe(0);
    expect(noConfirm.out).toMatch(/--yes-overwrite/);

    const same = run("deploy/restore.sh", ["--backup", encFile, "--target-url", ownerUrl, "--yes-overwrite"], {
      GNUPGHOME: gnupg,
      OWNER_DATABASE_URL: ownerUrl,
    });
    expect(same.status).not.toBe(0);
    expect(same.out).toMatch(/same database/);
  });

  it("restores into a separate database with the same data, and the keys open the links", async () => {
    await owner.query(`drop database if exists ${restoreDb}`);
    await owner.query(`create database ${restoreDb}`);

    const r = run("deploy/restore.sh", ["--backup", encFile, "--target-url", urlFor(restoreDb), "--yes-overwrite"], {
      GNUPGHOME: gnupg,
    });
    expect(r.out).toContain("rows_anonymous_links: 2");
    expect(r.status).toBe(0);

    const restored = new pg.Pool({ host, port, database: restoreDb, user: "postgres", password, max: 1 });
    const accounts = await restored.query(`select count(*)::int n from accounts`);
    const posts = await restored.query(`select count(*)::int n from posts where body = $1`, [MARKER]);
    const links = await restored.query(`select count(*)::int n from identity.anonymous_links`);
    await restored.end();
    expect(accounts.rows[0].n).toBe(2);
    expect(posts.rows[0].n).toBe(2);
    expect(links.rows[0].n).toBe(2);

    const verify = (keys: string, blind: string) =>
      spawnSync("npx", ["tsx", "src/scripts/verify-keys.ts"], {
        cwd: join(root, "apps/api"),
        env: {
          ...process.env,
          KEY_CHECK_DATABASE_URL: urlFor(restoreDb),
          LINK_ENCRYPTION_KEYS: keys,
          LINK_BLIND_INDEX_KEY: blind,
        },
        encoding: "utf8",
        timeout: 120_000,
      });

    const good = verify(encKeys, blindKey);
    expect(good.status).toBe(0);
    expect(good.stdout).toContain("OK: every link opens");

    const bad = verify(`1:${b64()}`, blindKey);
    expect(bad.status).not.toBe(0);
  }, 240_000);

  it("keeps an unencrypted backup only when it was asked for, and says so", () => {
    const dir = join(work, "plain");
    const r = run("deploy/backup.sh", ["--out", dir, "--unencrypted"], { OWNER_DATABASE_URL: ownerUrl });
    expect(r.status).toBe(0);
    expect(r.out).toContain("not encrypted");
    const dump = readdirSync(dir).find((f) => f.endsWith(".dump"))!;
    expect(readFileSync(join(dir, dump)).subarray(0, 5).toString("latin1")).toBe("PGDMP");
    expect(readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith(".manifest.txt"))!), "utf8")).toContain("encrypted: NO");
  }, 180_000);

  it("runs the drill against the backup, passes, and writes a record that leaves G7 open", () => {
    const records = join(work, "records");
    const r = run(
      "ops/restore-drill.sh",
      ["--backup", encFile, "--manifest", manifestFile, "--record-dir", records],
      { GNUPGHOME: gnupg, LINK_ENCRYPTION_KEYS: encKeys, LINK_BLIND_INDEX_KEY: blindKey },
    );
    expect(r.out).toContain("PASS (automated steps)");
    expect(r.status).toBe(0);

    const record = readFileSync(join(records, readdirSync(records)[0]!), "utf8");
    expect(record).toContain("Row counts match the manifest | yes");
    expect(record).toContain("OK: every link opens");
    expect(record).toContain("G7 stays open");
    expect(record).not.toContain(encKeys.split(":")[1]!);
    expect(record).not.toContain(blindKey);
  }, 300_000);

  it("fails the drill with the wrong keys, and says which step failed", () => {
    const records = join(work, "records-bad");
    const r = run(
      "ops/restore-drill.sh",
      ["--backup", encFile, "--manifest", manifestFile, "--record-dir", records],
      { GNUPGHOME: gnupg, LINK_ENCRYPTION_KEYS: `1:${b64()}`, LINK_BLIND_INDEX_KEY: blindKey },
    );
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("FAIL");
    const record = readFileSync(join(records, readdirSync(records)[0]!), "utf8");
    expect(record).toMatch(/FAIL: verify-keys reported a problem/);
  }, 300_000);
});
