import type { Pool } from "pg";
import type {
  ActionDetail,
  AdminStore,
  AppealRow,
  ContentPreview,
  Moderator,
  Outcome,
  PenaltyKind,
  QueueRow,
  ReportDetail,
  TargetDetail,
  TargetKind,
} from "./store.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Row = Record<string, any>;

function preview(r: Row): ContentPreview {
  return {
    text: r.text ?? null,
    authorProfileId: r.author_id,
    authorKind: r.author_kind,
    authorHandle: r.author_handle,
    authorDisplayName: r.author_kind === "anonymous" ? null : r.author_display_name,
    hidden: r.hidden_at !== null,
    hiddenReason: r.hidden_reason ?? null,
    deleted: r.deleted_at !== null,
  };
}

const PREVIEW_SQL: Record<TargetKind, string> = {
  post: `select p.id, p.body as text, p.hidden_at, p.hidden_reason, p.deleted_at,
                a.id as author_id, a.kind as author_kind, a.handle as author_handle,
                a.display_name as author_display_name
           from posts p join profiles a on a.id = p.author_profile_id
          where p.id = any($1::uuid[])`,
  comment: `select c.id, c.body as text, c.hidden_at, c.hidden_reason, c.deleted_at,
                   a.id as author_id, a.kind as author_kind, a.handle as author_handle,
                   a.display_name as author_display_name
              from comments c join profiles a on a.id = c.author_profile_id
             where c.id = any($1::uuid[])`,
  profile: `select a.id, null::text as text, null::timestamptz as hidden_at,
                   null::text as hidden_reason, a.deleted_at,
                   a.id as author_id, a.kind as author_kind, a.handle as author_handle,
                   a.display_name as author_display_name
              from profiles a where a.id = any($1::uuid[])`,
};

export class PgAdminStore implements AdminStore {
  constructor(private readonly pool: Pool) {}

  async findModeratorByTokenHash(hash: Buffer): Promise<Moderator | null> {
    const r = await this.pool.query(
      `select id, name from moderation.moderators where token_hash = $1 and active`,
      [hash],
    );
    return r.rows[0] ? { id: r.rows[0].id, name: r.rows[0].name } : null;
  }

  async queue(opts: { limit: number; offset: number }): Promise<QueueRow[]> {
    const groups = await this.pool.query(
      `select target_kind, target_id,
              bool_or(urgent) as urgent,
              count(*) filter (where source = 'user')::int as user_reports,
              count(*) filter (where source = 'auto')::int as auto_flags,
              min(created_at) as oldest,
              array_agg(reason::text) as reasons
         from moderation.reports
        where status = 'open'
        group by target_kind, target_id
        order by bool_or(urgent) desc, min(created_at) asc
        limit $1 offset $2`,
      [opts.limit, opts.offset],
    );

    const idsByKind: Record<TargetKind, string[]> = { post: [], comment: [], profile: [] };
    for (const g of groups.rows) idsByKind[g.target_kind as TargetKind].push(g.target_id);

    const previews = new Map<string, ContentPreview>();
    for (const kind of ["post", "comment", "profile"] as const) {
      const ids = idsByKind[kind];
      if (ids.length === 0) continue;
      const r = await this.pool.query(PREVIEW_SQL[kind], [ids]);
      for (const row of r.rows) previews.set(`${kind}:${row.id}`, preview(row));
    }

    return groups.rows.map((g): QueueRow => {
      const reasons: Record<string, number> = {};
      for (const reason of g.reasons as string[]) reasons[reason] = (reasons[reason] ?? 0) + 1;
      return {
        targetKind: g.target_kind,
        targetId: g.target_id,
        urgent: g.urgent,
        userReports: g.user_reports,
        autoFlags: g.auto_flags,
        reasons,
        oldestReportAt: new Date(g.oldest),
        preview: previews.get(`${g.target_kind}:${g.target_id}`) ?? null,
      };
    });
  }

  async targetDetail(kind: TargetKind, id: string): Promise<TargetDetail | null> {
    if (!UUID_RE.test(id)) return null;
    const p = await this.pool.query(PREVIEW_SQL[kind], [[id]]);
    if (!p.rows[0]) return null;

    let photos: TargetDetail["photos"] = [];
    let postId: string | null = null;
    if (kind === "post") {
      postId = id;
      const ph = await this.pool.query(
        `select u.id, u.width, u.height, u.alt_text
           from post_photos pp join photo_uploads u on u.storage_key = pp.storage_key
          where pp.post_id = $1 order by pp.position`,
        [id],
      );
      photos = ph.rows.map((r) => ({
        uploadId: r.id,
        width: r.width,
        height: r.height,
        altText: r.alt_text ?? null,
      }));
    } else if (kind === "comment") {
      const c = await this.pool.query(`select post_id from comments where id = $1`, [id]);
      postId = c.rows[0]?.post_id ?? null;
    }

    const reports = await this.pool.query(
      `select id, reason::text as reason, detail, source, status::text as status,
              created_at, resolved_at, resolved_by
         from moderation.reports
        where target_kind = $1::report_target and target_id = $2
        order by created_at`,
      [kind, id],
    );
    const actions = await this.pool.query(
      `select id, kind::text as kind, moderator, note, created_at
         from moderation.actions
        where target_kind = $1::report_target and target_id = $2
        order by created_at`,
      [kind, id],
    );

    return {
      targetKind: kind,
      targetId: id,
      preview: preview(p.rows[0]),
      photos,
      postId,
      reports: reports.rows.map(
        (r): ReportDetail => ({
          id: r.id,
          reason: r.reason,
          detail: r.detail,
          source: r.source,
          status: r.status,
          createdAt: new Date(r.created_at),
          resolvedAt: r.resolved_at ? new Date(r.resolved_at) : null,
          resolvedBy: r.resolved_by,
        }),
      ),
      actions: actions.rows.map(
        (a): ActionDetail => ({
          id: a.id,
          kind: a.kind,
          moderator: a.moderator,
          note: a.note,
          createdAt: new Date(a.created_at),
        }),
      ),
    };
  }

  async resolveTarget(input: {
    kind: TargetKind;
    id: string;
    outcome: Outcome;
    moderator: string;
    note: string | null;
    now: Date;
  }) {
    if (!UUID_RE.test(input.id)) return null;
    const client = await this.pool.connect();
    try {
      await client.query("begin");

      const exists = await client.query(PREVIEW_SQL[input.kind], [[input.id]]);
      if (!exists.rows[0]) {
        await client.query("rollback");
        return null;
      }

      let contentHidden = false;
      let contentRestored = false;
      if (input.kind !== "profile") {
        const table = input.kind === "post" ? "posts" : "comments";
        if (input.outcome === "uphold") {
          const r = await client.query(
            `update ${table} set hidden_at = $2, hidden_reason = 'moderator'
              where id = $1 and hidden_at is null`,
            [input.id, input.now],
          );
          contentHidden = (r.rowCount ?? 0) > 0;
        } else {
          const r = await client.query(
            `update ${table} set hidden_at = null, hidden_reason = null
              where id = $1 and hidden_reason = 'auto_reports'`,
            [input.id],
          );
          contentRestored = (r.rowCount ?? 0) > 0;
        }
      }

      const closed = await client.query(
        `update moderation.reports
            set status = $3::report_status, resolved_at = $4, resolved_by = $5
          where target_kind = $1::report_target and target_id = $2 and status = 'open'`,
        [
          input.kind,
          input.id,
          input.outcome === "uphold" ? "actioned" : "dismissed",
          input.now,
          input.moderator,
        ],
      );

      const actionKind = contentHidden
        ? "hide_content"
        : contentRestored
          ? "restore_content"
          : "close_report";
      await client.query(
        `insert into moderation.actions (kind, moderator, target_kind, target_id, note, created_at)
         values ($1::moderation_action_kind, $2, $3::report_target, $4, $5, $6)`,
        [actionKind, input.moderator, input.kind, input.id, input.note, input.now],
      );

      await client.query("commit");
      return { reportsClosed: closed.rowCount ?? 0, contentHidden, contentRestored };
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async profileKind(profileId: string): Promise<"known" | "anonymous" | null> {
    if (!UUID_RE.test(profileId)) return null;
    const r = await this.pool.query(`select kind from profiles where id = $1`, [profileId]);
    return r.rows[0]?.kind ?? null;
  }

  async penalize(input: {
    profileId: string;
    profileKind: "known" | "anonymous";
    blindIndex: Buffer | null;
    kind: PenaltyKind;
    endsAt: Date | null;
    moderator: string;
    note: string;
  }): Promise<void> {
    const actionKind =
      input.kind === "warning" ? "warn" : input.kind === "suspension" ? "suspend" : "ban";
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const action = await client.query(
        `insert into moderation.actions (kind, moderator, target_kind, target_id, note)
         values ($1::moderation_action_kind, $2, 'profile', $3, $4) returning id`,
        [actionKind, input.moderator, input.profileId, input.note],
      );
      const actionId: string = action.rows[0].id;

      if (input.profileKind === "known") {
        await client.query(
          `select identity.apply_penalty_for_known_profile($1, $2, $3, $4)`,
          [input.profileId, input.kind, actionId, input.endsAt],
        );
      } else {
        await client.query(
          `select identity.apply_penalty_for_profile($1, $2, $3, $4, $5)`,
          [input.blindIndex, input.kind, actionId, input.endsAt, input.profileId],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async listAppeals(status: "open" | "upheld" | "denied"): Promise<AppealRow[]> {
    const r = await this.pool.query(
      `select id, message, status, created_at, decided_at, decided_by, decision_note
         from moderation.appeals where status = $1 order by created_at`,
      [status],
    );
    return r.rows.map(
      (a): AppealRow => ({
        id: a.id,
        message: a.message,
        status: a.status,
        createdAt: new Date(a.created_at),
        decidedAt: a.decided_at ? new Date(a.decided_at) : null,
        decidedBy: a.decided_by,
        decisionNote: a.decision_note,
      }),
    );
  }

  async decideAppeal(input: {
    id: string;
    decision: "upheld" | "denied";
    moderator: string;
    note: string;
  }): Promise<boolean> {
    if (!UUID_RE.test(input.id)) return false;
    const r = await this.pool.query(`select moderation.decide_appeal($1, $2, $3, $4) as ok`, [
      input.id,
      input.decision,
      input.moderator,
      input.note,
    ]);
    return r.rows[0].ok === true;
  }

  async photoStorageKey(uploadId: string): Promise<string | null> {
    if (!UUID_RE.test(uploadId)) return null;
    const r = await this.pool.query(`select storage_key from photo_uploads where id = $1`, [
      uploadId,
    ]);
    return r.rows[0]?.storage_key ?? null;
  }
}
