import Fastify, { type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import type { PhotoStore } from "../content/photos.js";
import { ApiError, clientErrorResponse } from "../errors.js";
import { registerConsole } from "./console.js";
import { registerRateLimit, registerSecurityHeaders, type RateLimitOptions } from "../security/http.js";
import type { AdminService } from "./service.js";
import type { Moderator } from "./store.js";

const id = z.string().uuid();
const kind = z.enum(["post", "comment", "profile"]);
const targetParams = z.object({ kind, id });

const resolveBody = z.object({
  outcome: z.enum(["uphold", "dismiss"]),
  note: z.string().max(1000).nullish(),
});

const penaltyBody = z
  .object({
    kind: z.enum(["warning", "suspension", "ban"]),
    endsAt: z.string().datetime().nullish(),
    note: z.string().max(1000),
  })
  .strict();

const decisionBody = z.object({
  decision: z.enum(["upheld", "denied"]),
  note: z.string().max(1000),
});

const queueQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
});

export interface AdminAppDeps {
  admin: AdminService;
  photos: PhotoStore;
  logger?: boolean;
  http?: { production?: boolean; trustProxyHops?: number; rateLimit?: RateLimitOptions | false };
}

export function buildAdminApp(deps: AdminAppDeps) {
  const hops = deps.http?.trustProxyHops ?? 0;
  const app = Fastify({
    logger: deps.logger === false ? false : { redact: ["req.headers.authorization"] },
    trustProxy: hops > 0 ? (_address: string, hop: number) => hop < hops : false,
    bodyLimit: 100 * 1024,
  });

  registerSecurityHeaders(app, { production: deps.http?.production ?? false });
  if (deps.http?.rateLimit) registerRateLimit(app, deps.http.rateLimit);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "Some fields are missing or invalid.",
        fields: err.issues.map((i) => i.path.join(".")),
      });
    }
    const client = clientErrorResponse(err);
    if (client) return reply.code(client.status).send(client.body);
    app.log.error(err);
    return reply.code(500).send({ error: "internal_error", message: "Something went wrong." });
  });

  async function moderator(req: FastifyRequest): Promise<Moderator> {
    const h = req.headers.authorization;
    const token = h?.startsWith("Bearer ") ? h.slice("Bearer ".length).trim() : "";
    if (!token) throw new ApiError("unauthorized", 401, "Invalid moderator token.");
    return deps.admin.authenticate(token);
  }

  app.get("/health", async () => ({ status: "ok" }));

  registerConsole(app);

  app.get("/admin/queue", async (req) => {
    await moderator(req);
    return deps.admin.queue(queueQuery.parse(req.query));
  });

  app.get("/admin/targets/:kind/:id", async (req, reply) => {
    await moderator(req);
    const p = targetParams.parse(req.params);
    return reply.header("cache-control", "no-store").send(await deps.admin.target(p.kind, p.id));
  });

  app.post("/admin/targets/:kind/:id/resolve", async (req) => {
    const m = await moderator(req);
    const p = targetParams.parse(req.params);
    const body = resolveBody.parse(req.body);
    return deps.admin.resolve(m, p.kind, p.id, body.outcome, body.note ?? null);
  });

  app.post("/admin/profiles/:id/penalties", async (req, reply) => {
    const m = await moderator(req);
    const { id: profileId } = z.object({ id }).parse(req.params);
    const body = penaltyBody.parse(req.body);
    const out = await deps.admin.penalize(m, {
      profileId,
      kind: body.kind,
      endsAt: body.endsAt ? new Date(body.endsAt) : null,
      note: body.note,
    });
    return reply.code(201).send(out);
  });

  app.post("/admin/profiles/:id/avatar/remove", async (req) => {
    const m = await moderator(req);
    const { id: profileId } = z.object({ id }).parse(req.params);
    const { note } = z.object({ note: z.string().max(1000) }).strict().parse(req.body);
    return deps.admin.removeAvatar(m, { profileId, note });
  });

  app.get("/admin/appeals", async (req) => {
    await moderator(req);
    const { status } = z
      .object({ status: z.enum(["open", "upheld", "denied"]).default("open") })
      .parse(req.query);
    return deps.admin.appeals(status);
  });

  app.post("/admin/appeals/:id/decision", async (req) => {
    const m = await moderator(req);
    const { id: appealId } = z.object({ id }).parse(req.params);
    const body = decisionBody.parse(req.body);
    return deps.admin.decideAppeal(m, appealId, body.decision, body.note);
  });

  app.get("/admin/photos/:id", async (req, reply) => {
    await moderator(req);
    const { id: uploadId } = z.object({ id }).parse(req.params);
    const key = await deps.admin.photoKey(uploadId);
    const bytes = await deps.photos.get(key);
    if (!bytes) throw new ApiError("not_found", 404, "Not found.");
    return reply
      .header("content-type", "image/jpeg")
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .send(bytes);
  });

  return app;
}
