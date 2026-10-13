import type { Pool } from "pg";
import { safeEqual } from "./crypto.js";
import type {
  AccountRow,
  AccountStatus,
  AccountStanding,
  AuthStore,
  KnownProfileDetails,
  UpdateProfileResult,
  CodePurpose,
  CreateAnonymousResult,
  ConsumeOutcome,
  CreateAccountResult,
  NewAccount,
  SessionRow,
  University,
} from "./store.js";

const UNIQUE_VIOLATION = "23505";

interface PgError {
  code?: string;
  constraint?: string;
}

export class PgAuthStore implements AuthStore {
  constructor(private readonly pool: Pool) {}

  async findUniversityByDomain(domain: string): Promise<University | null> {
    const r = await this.pool.query(
      `select id, name, email_domain, active from universities where email_domain = $1`,
      [domain],
    );
    const row = r.rows[0];
    if (!row) return null;
    return { id: row.id, name: row.name, emailDomain: row.email_domain, active: row.active };
  }

  async isEmailBanned(emailHash: Buffer): Promise<boolean> {
    const r = await this.pool.query(`select 1 from banned_emails where email_hash = $1`, [
      emailHash,
    ]);
    return r.rowCount === 1;
  }

  async findAccountByEmail(email: string): Promise<AccountRow | null> {
    const r = await this.pool.query(
      `select id, email, status, university_id from accounts where email = $1`,
      [email],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      status: row.status as AccountStatus,
      universityId: row.university_id,
    };
  }

  async countCodesSince(email: string, since: Date): Promise<number> {
    const r = await this.pool.query(
      `select count(*)::int as n from email_codes where email = $1 and created_at >= $2`,
      [email, since],
    );
    return r.rows[0]?.n ?? 0;
  }

  async createCode(input: {
    email: string;
    codeHash: Buffer;
    purpose: CodePurpose;
    expiresAt: Date;
    now: Date;
  }): Promise<void> {
    await this.pool.query(
      `insert into email_codes (email, code_hash, purpose, expires_at, created_at)
       values ($1, $2, $3, $4, $5)`,
      [input.email, input.codeHash, input.purpose, input.expiresAt, input.now],
    );
  }

  async consumeCode(input: {
    email: string;
    purpose: CodePurpose;
    codeHash: Buffer;
    now: Date;
    maxAttempts: number;
  }): Promise<ConsumeOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const r = await client.query(
        `select id, code_hash, expires_at, attempts
           from email_codes
          where email = $1 and purpose = $2 and consumed_at is null
          order by created_at desc
          limit 1
          for update`,
        [input.email, input.purpose],
      );
      const row = r.rows[0];
      if (!row) {
        await client.query("commit");
        return "invalid";
      }
      if (row.attempts >= input.maxAttempts) {
        await client.query("commit");
        return "too_many_attempts";
      }
      if (new Date(row.expires_at) <= input.now) {
        await client.query("commit");
        return "expired";
      }
      if (!safeEqual(row.code_hash, input.codeHash)) {
        await client.query(`update email_codes set attempts = attempts + 1 where id = $1`, [
          row.id,
        ]);
        await client.query("commit");
        return "invalid";
      }
      await client.query(`update email_codes set consumed_at = $2 where id = $1`, [
        row.id,
        input.now,
      ]);
      await client.query("commit");
      return "ok";
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async createAccountWithKnownProfile(input: NewAccount): Promise<CreateAccountResult> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");

      const acc = await client.query(
        `insert into accounts
           (university_id, email, date_of_birth, terms_accepted_at, terms_version,
            email_verified_at, last_reverified_at, reverify_due_at, created_at)
         values ($1, $2, $3, $4, $5, $4, $4, $6, $4)
         returning id`,
        [
          input.universityId,
          input.email,
          input.dateOfBirth,
          input.now,
          input.termsVersion,
          input.reverifyDueAt,
        ],
      );
      const accountId: string = acc.rows[0].id;

      const prof = await client.query(
        `insert into profiles (kind, university_id, handle, display_name, course, study_year)
         values ('known', $1, $2, $3, $4, $5)
         returning id`,
        [
          input.universityId,
          input.profile.handle,
          input.profile.displayName,
          input.profile.course,
          input.profile.studyYear,
        ],
      );
      const profileId: string = prof.rows[0].id;

      await client.query(
        `insert into identity.known_profile_owner (account_id, profile_id) values ($1, $2)`,
        [accountId, profileId],
      );

      await client.query("commit");
      return { kind: "created", accountId, profileId };
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      const e = err as PgError;
      if (e.code === UNIQUE_VIOLATION) {
        if (e.constraint === "accounts_email_key") return { kind: "email_taken" };
        if (e.constraint === "profiles_university_id_handle_key") return { kind: "handle_taken" };
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async createSession(input: {
    accountId: string;
    tokenHash: Buffer;
    deviceLabel: string | null;
    now: Date;
    expiresAt: Date;
  }): Promise<void> {
    await this.pool.query(
      `insert into sessions (account_id, refresh_hash, device_label, created_at, expires_at)
       values ($1, $2, $3, $4, $5)`,
      [input.accountId, input.tokenHash, input.deviceLabel, input.now, input.expiresAt],
    );
  }

  async findSession(tokenHash: Buffer, now: Date): Promise<SessionRow | null> {
    const r = await this.pool.query(
      `select s.account_id, a.email, a.status, o.profile_id
         from sessions s
         join accounts a on a.id = s.account_id
         join identity.known_profile_owner o on o.account_id = a.id
        where s.refresh_hash = $1 and s.revoked_at is null and s.expires_at > $2`,
      [tokenHash, now],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      accountId: row.account_id,
      email: row.email,
      status: row.status as AccountStatus,
      knownProfileId: row.profile_id,
    };
  }

  async getKnownProfileDetails(profileId: string) {
    const r = await this.pool.query(
      `select id, handle, display_name, course, study_year
         from profiles where id = $1 and kind = 'known' and deleted_at is null`,
      [profileId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      profileId: row.id as string,
      handle: row.handle as string,
      displayName: row.display_name as string,
      course: (row.course as string | null) ?? null,
      studyYear: (row.study_year as number | null) ?? null,
    };
  }

  async updateKnownProfile(input: {
    profileId: string;
    now: Date;
    set: {
      displayName?: string;
      course?: string | null;
      studyYear?: number | null;
      handle?: string;
    };
    maxEdits: number;
    windowDays: number;
  }): Promise<UpdateProfileResult> {
    const s = input.set;
    try {
      const r = await this.pool.query(
        `update profiles set
            display_name = case when $3::boolean then $4 else display_name end,
            course       = case when $5::boolean then $6 else course end,
            study_year   = case when $7::boolean then $8 else study_year end,
            handle       = case when $9::boolean then $10 else handle end,
            edit_window_started_at =
              case when edit_window_started_at is null
                     or edit_window_started_at <= $2::timestamptz - make_interval(days => $11)
                   then $2::timestamptz else edit_window_started_at end,
            edits_in_window =
              case when edit_window_started_at is null
                     or edit_window_started_at <= $2::timestamptz - make_interval(days => $11)
                   then 1 else edits_in_window + 1 end
          where id = $1 and kind = 'known' and deleted_at is null
            and (edit_window_started_at is null
                 or edit_window_started_at <= $2::timestamptz - make_interval(days => $11)
                 or edits_in_window < $12)
          returning id`,
        [
          input.profileId,
          input.now,
          s.displayName !== undefined,
          s.displayName ?? null,
          s.course !== undefined,
          s.course ?? null,
          s.studyYear !== undefined,
          s.studyYear ?? null,
          s.handle !== undefined,
          s.handle ?? null,
          input.windowDays,
          input.maxEdits,
        ],
      );
      if (r.rowCount === 1) return "updated";

      const exists = await this.pool.query(
        `select 1 from profiles where id = $1 and kind = 'known' and deleted_at is null`,
        [input.profileId],
      );
      return exists.rowCount === 1 ? "rate_limited" : "not_found";
    } catch (err) {
      const e = err as PgError;
      if (e.code === UNIQUE_VIOLATION && e.constraint === "profiles_university_id_handle_key") {
        return "handle_taken";
      }
      throw err;
    }
  }

  async getStanding(accountId: string) {
    const r = await this.pool.query(
      `select created_at, strike_count, status from accounts where id = $1`,
      [accountId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      createdAt: new Date(row.created_at),
      strikeCount: row.strike_count as number,
      status: row.status as AccountStatus,
    };
  }

  async getAnonymousLink(accountId: string): Promise<Buffer | null> {
    const r = await this.pool.query(
      `select anon_profile_enc from identity.anonymous_links where account_id = $1`,
      [accountId],
    );
    return r.rows[0]?.anon_profile_enc ?? null;
  }

  async createAnonymousProfile(input: {
    accountId: string;
    profileId: string;
    handle: string;
    avatarKey: string;
    enc: Buffer;
    keyVersion: number;
    blindIndex: Buffer;
    now: Date;
  }): Promise<CreateAnonymousResult> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const acc = await client.query(`select university_id from accounts where id = $1`, [
        input.accountId,
      ]);
      const universityId: string | undefined = acc.rows[0]?.university_id;
      if (!universityId) {
        await client.query("rollback");
        return "exists";
      }

      await client.query(
        `insert into profiles (id, kind, university_id, handle, avatar_key, created_at)
         values ($1, 'anonymous', $2, $3, $4,
                 date_trunc('day', $5::timestamptz at time zone 'UTC') at time zone 'UTC')`,
        [input.profileId, universityId, input.handle, input.avatarKey, input.now],
      );
      await client.query(
        `insert into identity.anonymous_links
           (account_id, anon_profile_enc, anon_blind_index, key_version)
         values ($1, $2, $3, $4)`,
        [input.accountId, input.enc, input.blindIndex, input.keyVersion],
      );
      await client.query("commit");
      return "created";
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      const e = err as PgError;
      if (e.code === UNIQUE_VIOLATION) {
        if (e.constraint === "anonymous_links_pkey") return "exists";
        if (e.constraint === "profiles_university_id_handle_key") return "handle_taken";
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async getProfileBasics(profileId: string) {
    const r = await this.pool.query(`select handle, avatar_key from profiles where id = $1`, [
      profileId,
    ]);
    const row = r.rows[0];
    return row ? { handle: row.handle as string, avatarKey: (row.avatar_key as string | null) } : null;
  }

  async createAppeal(input: {
    accountId: string;
    message: string;
    now: Date;
  }): Promise<"created" | "exists"> {
    const r = await this.pool.query(
      `insert into moderation.appeals (account_id, message, created_at)
       values ($1, $2, $3)
       on conflict (account_id) do nothing`,
      [input.accountId, input.message, input.now],
    );
    return r.rowCount === 1 ? "created" : "exists";
  }

  async markReverified(input: { accountId: string; now: Date; dueAt: Date }): Promise<void> {
    await this.pool.query(
      `update accounts
          set last_reverified_at = $2,
              email_verified_at  = $2,
              reverify_due_at    = $3,
              status = case when status = 'read_only' then 'active' else status end
        where id = $1`,
      [input.accountId, input.now, input.dueAt],
    );
  }

  async revokeSession(tokenHash: Buffer, now: Date): Promise<void> {
    await this.pool.query(
      `update sessions set revoked_at = $2 where refresh_hash = $1 and revoked_at is null`,
      [tokenHash, now],
    );
  }
}
