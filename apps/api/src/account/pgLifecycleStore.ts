import type { Pool, PoolClient } from "pg";
import type { ReminderCandidate, ReminderKind } from "./reminders.js";
import {
  AnonymousLinkUnreadable,
  AnonymousResolverMissing,
  EXPORT_NOTICE,
  EXPORT_NOT_INCLUDED,
  type AccountExport,
  type CloseInput,
  type ExportPhoto,
  type ModerationExport,
  type LifecycleStore,
  type PurgeResult,
} from "./lifecycleStore.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PgLifecycleOptions {
  decryptAnonymousProfileId?: (enc: Buffer, accountId: string) => string;
}

type Queryable = Pool | PoolClient;

export class PgLifecycleStore implements LifecycleStore {
  constructor(
    private readonly pool: Pool,
    private readonly opts: PgLifecycleOptions = {},
  ) {}

  async purgeDeletedContent(cutoff: Date, batchSize = 500) {
    let posts = 0;
    let comments = 0;

    for (let round = 0; round < 200; round += 1) {
      const n = await this.purgePostBatch(cutoff, batchSize);
      posts += n;
      if (n < batchSize) break;
    }
    for (let round = 0; round < 200; round += 1) {
      const n = await this.purgeCommentBatch(cutoff, batchSize);
      comments += n;
      if (n < batchSize) break;
    }
    return { posts, comments };
  }

  private async purgePostBatch(cutoff: Date, batchSize: number): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const r = await client.query(
        `select p.id from posts p
          where p.deleted_at is not null and p.deleted_at <= $1
            and not exists (select 1 from moderation.reports r
                             where r.target_kind = 'post' and r.target_id = p.id
                               and r.status = 'open')
          order by p.deleted_at
          limit $2
          for update of p skip locked`,
        [cutoff, batchSize],
      );
      const ids: string[] = r.rows.map((row) => row.id);
      if (ids.length > 0) {
        await client.query(
          `insert into storage_deletions (storage_key)
           select pp.storage_key from post_photos pp where pp.post_id = any($1)
           on conflict do nothing`,
          [ids],
        );
        await client.query(
          `delete from photo_uploads
            where storage_key in (select storage_key from post_photos where post_id = any($1))`,
          [ids],
        );
        // Cascades to comments, reactions and post_photos.
        await client.query(`delete from posts where id = any($1)`, [ids]);
      }
      await client.query("commit");
      return ids.length;
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async purgeCommentBatch(cutoff: Date, batchSize: number): Promise<number> {
    const r = await this.pool.query(
      `with doomed as (
         select c.id from comments c
          where c.deleted_at is not null and c.deleted_at <= $1
            and not exists (select 1 from moderation.reports r
                             where r.target_kind = 'comment' and r.target_id = c.id
                               and r.status = 'open')
          order by c.deleted_at
          limit $2
          for update of c skip locked
       )
       delete from comments where id in (select id from doomed)`,
      [cutoff, batchSize],
    );
    return r.rowCount ?? 0;
  }

  async cleanupStaleRecords(input: {
    now: Date;
    codeRetentionHours: number;
    sessionRetentionDays: number;
    staleUploadHours: number;
  }) {
    const codeCutoff = new Date(input.now.getTime() - input.codeRetentionHours * 3_600_000);
    const sessionCutoff = new Date(input.now.getTime() - input.sessionRetentionDays * 86_400_000);
    const uploadCutoff = new Date(input.now.getTime() - input.staleUploadHours * 3_600_000);

    const codes = await this.pool.query(`delete from email_codes where created_at < $1`, [
      codeCutoff,
    ]);
    const sessions = await this.pool.query(
      `delete from sessions
        where expires_at < $1 or (revoked_at is not null and revoked_at < $1)`,
      [sessionCutoff],
    );

    let uploads = 0;
    for (let round = 0; round < 200; round += 1) {
      const r = await this.pool.query(
        `with gone as (
           delete from photo_uploads
            where id in (select id from photo_uploads
                          where attached_at is null and created_at < $1
                          order by created_at
                          limit 500)
              and attached_at is null
           returning storage_key
         ),
         queued as (
           insert into storage_deletions (storage_key)
           select storage_key from gone
           on conflict do nothing
         )
         select count(*)::int as n from gone`,
        [uploadCutoff],
      );
      const n: number = r.rows[0].n;
      uploads += n;
      if (n < 500) break;
    }

    return { codes: codes.rowCount ?? 0, sessions: sessions.rowCount ?? 0, uploads };
  }

  async purgeModerationRecords(input: {
    now: Date;
    dismissedReportDays: number;
    resolvedRecordDays: number;
    appealRecordDays: number;
    warningMonths: number;
    auditLogYears: number;
  }) {
    const r = await this.pool.query(
      `select * from moderation.purge_expired_records($1, $2, $3, $4, $5, $6)`,
      [
        input.now,
        input.dismissedReportDays,
        input.resolvedRecordDays,
        input.appealRecordDays,
        input.warningMonths,
        input.auditLogYears,
      ],
    );
    const row = r.rows[0];
    return {
      warningsExpired: row.out_warnings_expired as number,
      reportsPurged: row.out_reports_purged as number,
      actionsPurged: row.out_actions_purged as number,
      penaltiesPurged: row.out_penalties_purged as number,
      appealsScrubbed: row.out_appeals_scrubbed as number,
      auditRowsPurged: row.out_audit_rows_purged as number,
    };
  }

  async takeStorageDeletions(limit: number): Promise<string[]> {
    const r = await this.pool.query(
      `select storage_key from storage_deletions order by queued_at, storage_key limit $1`,
      [limit],
    );
    return r.rows.map((row) => row.storage_key as string);
  }

  async completeStorageDeletions(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.pool.query(`delete from storage_deletions where storage_key = any($1)`, [keys]);
  }

  async countStorageDeletions(): Promise<number> {
    const r = await this.pool.query(`select count(*)::int n from storage_deletions`);
    return r.rows[0].n;
  }

  async hideBannedAnonymousContent(now: Date) {
    const r = await this.pool.query(
      `select a.id as account_id, l.anon_profile_enc
         from accounts a join identity.anonymous_links l on l.account_id = a.id
        where a.status = 'banned'`,
    );
    let hidden = 0;
    let skipped = 0;
    for (const row of r.rows) {
      if (!this.opts.decryptAnonymousProfileId) {
        skipped += 1;
        continue;
      }
      let profileId: string;
      try {
        profileId = this.opts.decryptAnonymousProfileId(row.anon_profile_enc, row.account_id);
      } catch {
        skipped += 1; // unreadable link: report it, keep going for everyone else
        continue;
      }
      const posts = await this.pool.query(
        `update posts set hidden_at = $2, hidden_reason = 'account_banned'
          where author_profile_id = $1 and hidden_at is null and deleted_at is null`,
        [profileId, now],
      );
      const comments = await this.pool.query(
        `update comments set hidden_at = $2, hidden_reason = 'account_banned'
          where author_profile_id = $1 and hidden_at is null and deleted_at is null`,
        [profileId, now],
      );
      const profile = await this.pool.query(
        `update profiles set deleted_at = $2 where id = $1 and deleted_at is null`,
        [profileId, now],
      );
      if ((posts.rowCount ?? 0) + (comments.rowCount ?? 0) + (profile.rowCount ?? 0) > 0) {
        hidden += 1;
      }
    }
    return { hidden, skipped };
  }

  async restoreUnbannedAnonymousContent() {
    const r = await this.pool.query(
      `select a.id as account_id, l.anon_profile_enc
         from accounts a join identity.anonymous_links l on l.account_id = a.id
        where a.status in ('active', 'read_only')`,
    );
    let restored = 0;
    let skipped = 0;
    for (const row of r.rows) {
      if (!this.opts.decryptAnonymousProfileId) {
        skipped += 1;
        continue;
      }
      let profileId: string;
      try {
        profileId = this.opts.decryptAnonymousProfileId(row.anon_profile_enc, row.account_id);
      } catch {
        skipped += 1;
        continue;
      }
      const profile = await this.pool.query(
        `update profiles set deleted_at = null where id = $1 and deleted_at is not null`,
        [profileId],
      );
      const posts = await this.pool.query(
        `update posts set hidden_at = null, hidden_reason = null
          where author_profile_id = $1 and hidden_reason = 'account_banned'`,
        [profileId],
      );
      const comments = await this.pool.query(
        `update comments set hidden_at = null, hidden_reason = null
          where author_profile_id = $1 and hidden_reason = 'account_banned'`,
        [profileId],
      );
      if ((posts.rowCount ?? 0) + (comments.rowCount ?? 0) + (profile.rowCount ?? 0) > 0) {
        restored += 1;
      }
    }
    return { restored, skipped };
  }

  async liftExpiredSuspensions(now: Date): Promise<number> {
    const r = await this.pool.query(
      `update accounts a set status = 'active'
        where a.status = 'suspended'
          and exists (select 1 from moderation.penalties p
                       where p.account_id = a.id and p.kind = 'suspension')
          and not exists (select 1 from moderation.penalties p
                           where p.account_id = a.id and p.kind = 'suspension'
                             and (p.ends_at is null or p.ends_at > $1))`,
      [now],
    );
    return r.rowCount ?? 0;
  }

  async listReminderCandidates(
    now: Date,
    input: { dueHorizonDays: number; closingHorizonDays: number; graceDays: number; limit: number },
  ): Promise<ReminderCandidate[]> {
    const r = await this.pool.query(
      `select a.id, a.email, a.status, a.reverify_due_at,
              coalesce(array_agg(r.kind || ':' || r.threshold_days::text)
                       filter (where r.account_id is not null), '{}') as sent
         from accounts a
         left join account_reminders r
           on r.account_id = a.id and r.cycle_due_at = a.reverify_due_at
        where (a.status = 'active'
               and a.reverify_due_at > $1
               and a.reverify_due_at <= $1 + make_interval(days => $2))
           or (a.status = 'read_only'
               and a.reverify_due_at + make_interval(days => $4) > $1
               and a.reverify_due_at + make_interval(days => $4) <= $1 + make_interval(days => $3))
        group by a.id
        order by a.reverify_due_at
        limit $5`,
      [now, input.dueHorizonDays, input.closingHorizonDays, input.graceDays, input.limit],
    );
    return r.rows.map((row) => ({
      accountId: row.id,
      email: row.email,
      status: row.status as "active" | "read_only",
      reverifyDueAt: row.reverify_due_at,
      sent: (row.sent as string[]).map((s) => {
        const [kind, days] = s.split(":");
        return { kind: kind as ReminderKind, thresholdDays: Number(days) };
      }),
    }));
  }

  async recordReminder(input: {
    accountId: string;
    kind: ReminderKind;
    thresholdDays: number;
    cycleDueAt: Date;
    now: Date;
  }): Promise<void> {
    await this.pool.query(
      `insert into account_reminders (account_id, kind, threshold_days, cycle_due_at, sent_at)
       values ($1, $2, $3, $4, $5)
       on conflict do nothing`,
      [input.accountId, input.kind, input.thresholdDays, input.cycleDueAt, input.now],
    );
  }

  async purgeOldReminders(cutoff: Date): Promise<number> {
    const r = await this.pool.query(`delete from account_reminders where sent_at < $1`, [cutoff]);
    return r.rowCount ?? 0;
  }

  async markOverdueReadOnly(now: Date): Promise<number> {
    const r = await this.pool.query(
      `update accounts set status = 'read_only'
        where status = 'active' and reverify_due_at <= $1`,
      [now],
    );
    return r.rowCount ?? 0;
  }

  async closeExpiredGrace(now: Date, graceDays: number) {
    const cutoff = new Date(now.getTime() - graceDays * DAY_MS);
    const r = await this.pool.query(
      `select id from accounts where status = 'read_only' and reverify_due_at <= $1`,
      [cutoff],
    );
    let closed = 0;
    let skipped = 0;
    for (const row of r.rows) {
      try {
        const ok = await this.closeAccount({
          accountId: row.id,
          reason: "reverification_expired",
          now,
        });
        if (ok) closed += 1;
      } catch (err) {
        if (err instanceof AnonymousResolverMissing) skipped += 1;
        else throw err;
      }
    }
    return { closed, skipped };
  }

  async closeAccount(input: CloseInput): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const profileIds = await this.profileIds(client, input.accountId);

      const upd = await client.query(
        `update accounts
            set status = 'closed', closed_at = $2, closed_reason = $3
          where id = $1 and status in ('active', 'read_only', 'suspended')
          returning id`,
        [input.accountId, input.now, input.reason],
      );
      if (upd.rowCount === 0) {
        await client.query("rollback");
        return false;
      }

      await client.query(
        `update sessions set revoked_at = $2 where account_id = $1 and revoked_at is null`,
        [input.accountId, input.now],
      );
      await client.query(
        `update posts set deleted_at = $2
          where author_profile_id = any($1) and deleted_at is null`,
        [profileIds, input.now],
      );
      await client.query(
        `update comments set deleted_at = $2
          where author_profile_id = any($1) and deleted_at is null`,
        [profileIds, input.now],
      );
      await client.query(
        `update profiles set deleted_at = $2 where id = any($1) and deleted_at is null`,
        [profileIds, input.now],
      );

      await client.query("commit");
      return true;
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async purgeClosedBefore(cutoff: Date): Promise<PurgeResult> {
    const r = await this.pool.query(
      `select id from accounts
        where status = 'closed' and purged_at is null and closed_at <= $1`,
      [cutoff],
    );
    let purged = 0;
    let skipped = 0;
    for (const row of r.rows) {
      try {
        await this.purgeOne(row.id);
        purged += 1;
      } catch (err) {
        if (err instanceof AnonymousResolverMissing) skipped += 1;
        else throw err;
      }
    }
    return { purged, skipped };
  }

  async exportAccount(accountId: string, now: Date): Promise<AccountExport> {
    const ids = await this.profileIds(this.pool, accountId);
    const iso = (d: unknown) => new Date(d as string).toISOString();
    const isoOrNull = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

    const acc = await this.pool.query(
      `select email, status, to_char(date_of_birth, 'YYYY-MM-DD') as dob, terms_version,
              terms_accepted_at, created_at, last_reverified_at, reverify_due_at,
              strike_count, closed_at
         from accounts where id = $1`,
      [accountId],
    );
    const a = acc.rows[0];
    if (!a) throw new Error("account not found");

    const profiles = await this.pool.query(
      `select id, kind, handle, display_name, course, study_year, created_at
         from profiles where id = any($1) order by kind`,
      [ids],
    );
    const kindById = new Map<string, "known" | "anonymous">(
      profiles.rows.map((p) => [p.id as string, p.kind as "known" | "anonymous"]),
    );
    const kind = (id: string) => kindById.get(id) ?? "known";

    const posts = await this.pool.query(
      `select p.author_profile_id, p.body, p.created_at, p.hidden_at, p.hidden_reason,
              coalesce(json_agg(json_build_object('id', u.id, 'width', u.width, 'height', u.height,
                                        'altText', u.alt_text)
                                order by pp.position) filter (where u.id is not null), '[]') as photos
         from posts p
         left join post_photos pp on pp.post_id = p.id
         left join photo_uploads u on u.storage_key = pp.storage_key
        where p.author_profile_id = any($1) and p.deleted_at is null
        group by p.id
        order by p.created_at`,
      [ids],
    );
    const comments = await this.pool.query(
      `select author_profile_id, body, created_at, hidden_at
         from comments
        where author_profile_id = any($1) and deleted_at is null
        order by created_at`,
      [ids],
    );
    const reactions = await this.pool.query(
      `select profile_id, post_id, comment_id, created_at
         from reactions where profile_id = any($1) order by created_at`,
      [ids],
    );
    const following = await this.pool.query(
      `select f.follower_profile_id, p.handle
         from follows f join profiles p on p.id = f.followee_profile_id
        where f.follower_profile_id = any($1)`,
      [ids],
    );
    const followers = await this.pool.query(
      `select f.followee_profile_id as profile_id, count(*)::int as n
         from follows f join profiles fp on fp.id = f.follower_profile_id and fp.deleted_at is null
        where f.followee_profile_id = any($1)
        group by f.followee_profile_id`,
      [ids],
    );
    const notifications = await this.pool.query(
      `select n.profile_id, n.kind, n.created_at, n.read_at, a.handle as from_handle
         from notifications n
         left join profiles a on a.id = (n.payload->>'actorProfileId')::uuid
        where n.profile_id = any($1)
        order by n.created_at`,
      [ids],
    );
    const photos = await this.pool.query(
      `select id, width, height, alt_text, created_at, attached_at
         from photo_uploads where profile_id = any($1) order by created_at`,
      [ids],
    );
    const sessions = await this.pool.query(
      `select device_label, created_at, expires_at, revoked_at
         from sessions where account_id = $1 order by created_at desc limit 200`,
      [accountId],
    );

    const mod = await this.pool.query(
      `select moderation.export_account_records($1, $2) as records`,
      [accountId, ids],
    );
    const records = mod.rows[0].records as ModerationExport;

    const photoUrl = (id: string) => `/photos/${id}`;
    const toPhoto = (p: {
      id: string;
      width: number;
      height: number;
      altText?: string | null;
      alt_text?: string | null;
    }): ExportPhoto => ({
      id: p.id,
      url: photoUrl(p.id),
      width: p.width,
      height: p.height,
      altText: p.altText ?? p.alt_text ?? null,
    });

    return {
      schemaVersion: 2,
      exportedAt: now.toISOString(),
      notice: EXPORT_NOTICE,
      account: {
        email: a.email,
        status: a.status,
        dateOfBirth: a.dob,
        termsVersion: a.terms_version,
        termsAcceptedAt: iso(a.terms_accepted_at),
        createdAt: iso(a.created_at),
        lastReverifiedAt: iso(a.last_reverified_at),
        reverifyDueAt: iso(a.reverify_due_at),
        warningsCounting: a.strike_count,
        closedAt: isoOrNull(a.closed_at),
      },
      profiles: profiles.rows.map((p) => ({
        kind: p.kind,
        handle: p.handle,
        displayName: p.display_name,
        course: p.course,
        studyYear: p.study_year,
        createdAt: iso(p.created_at),
      })),
      posts: posts.rows.map((p) => ({
        profile: kind(p.author_profile_id),
        body: p.body,
        photos: (p.photos as { id: string; width: number; height: number; altText: string | null }[]).map(toPhoto),
        createdAt: iso(p.created_at),
        hidden: p.hidden_at !== null,
        hiddenReason: p.hidden_reason ?? null,
      })),
      comments: comments.rows.map((c) => ({
        profile: kind(c.author_profile_id),
        body: c.body,
        createdAt: iso(c.created_at),
        hidden: c.hidden_at !== null,
      })),
      reactions: reactions.rows.map((r) => ({
        profile: kind(r.profile_id),
        on: r.post_id ? ("post" as const) : ("comment" as const),
        targetId: (r.post_id ?? r.comment_id) as string,
        createdAt: iso(r.created_at),
      })),
      following: following.rows.map((f) => ({
        as: kind(f.follower_profile_id),
        handle: f.handle,
      })),
      followers: ids.map((id) => ({
        profile: kind(id),
        count: followers.rows.find((f) => f.profile_id === id)?.n ?? 0,
      })),
      notifications: notifications.rows.map((n) => ({
        profile: kind(n.profile_id),
        kind: n.kind,
        createdAt: iso(n.created_at),
        read: n.read_at !== null,
        fromHandle: n.from_handle ?? null,
      })),
      photos: photos.rows.map((p) => ({
        ...toPhoto(p),
        uploadedAt: iso(p.created_at),
        attachedToPost: p.attached_at !== null,
      })),
      sessions: sessions.rows.map((s) => ({
        deviceLabel: s.device_label ?? null,
        createdAt: iso(s.created_at),
        expiresAt: iso(s.expires_at),
        revoked: s.revoked_at !== null,
      })),
      moderation: records,
      notIncluded: EXPORT_NOT_INCLUDED,
    };
  }

  private async profileIds(db: Queryable, accountId: string): Promise<string[]> {
    const ids: string[] = [];

    const known = await db.query(
      `select profile_id from identity.known_profile_owner where account_id = $1`,
      [accountId],
    );
    for (const row of known.rows) ids.push(row.profile_id);

    const link = await db.query(
      `select anon_profile_enc from identity.anonymous_links where account_id = $1`,
      [accountId],
    );
    const enc: Buffer | undefined = link.rows[0]?.anon_profile_enc;
    if (enc) {
      if (!this.opts.decryptAnonymousProfileId) throw new AnonymousResolverMissing();
      try {
        ids.push(this.opts.decryptAnonymousProfileId(enc, accountId));
      } catch {
        throw new AnonymousLinkUnreadable();
      }
    }
    return ids;
  }

  private async purgeOne(accountId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const ids = await this.profileIds(client, accountId);

      const acc = await client.query(`select email from accounts where id = $1 for update`, [
        accountId,
      ]);
      const email: string | undefined = acc.rows[0]?.email;

      await client.query(`delete from notifications where profile_id = any($1)`, [ids]);
      await client.query(`delete from push_tokens where profile_id = any($1)`, [ids]);
      await client.query(`delete from reactions where profile_id = any($1)`, [ids]);
      await client.query(
        `delete from follows where follower_profile_id = any($1) or followee_profile_id = any($1)`,
        [ids],
      );
      await client.query(`delete from comments where author_profile_id = any($1)`, [ids]);
      await client.query(
        `insert into storage_deletions (storage_key)
         select storage_key from photo_uploads where profile_id = any($1)
         on conflict do nothing`,
        [ids],
      );
      await client.query(`delete from photo_uploads where profile_id = any($1)`, [ids]);
      // Cascades to the post's photos, comments and reactions.
      await client.query(`delete from posts where author_profile_id = any($1)`, [ids]);
      await client.query(`delete from profiles where id = any($1)`, [ids]);
      await client.query(`delete from identity.anonymous_links where account_id = $1`, [accountId]);
      await client.query(`delete from sessions where account_id = $1`, [accountId]);
      if (email) await client.query(`delete from email_codes where email = $1`, [email]);

      await client.query(
        `update accounts
            set email = 'closed-' || id::text || '@purged.invalid',
                date_of_birth = null,
                purged_at = now()
          where id = $1`,
        [accountId],
      );

      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
