import Fastify from "fastify";
import { ZodError } from "zod";
import type { AuthService } from "./auth/service.js";
import { ApiError, clientErrorResponse } from "./errors.js";
import type { AccountService } from "./account/service.js";
import type { ActorResolver } from "./content/actor.js";
import type { ContentService } from "./content/service.js";
import type { IdentityService } from "./identity/service.js";
import type { ProfileService } from "./profile/service.js";
import type { ReportService } from "./moderation/reports.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerContentRoutes } from "./routes/content.js";
import { registerIdentityRoutes } from "./routes/identity.js";
import { registerProfileRoutes } from "./routes/profile.js";
import { registerRateLimit, registerSecurityHeaders, type RateLimitOptions } from "./security/http.js";

export interface AppDeps {
  auth: AuthService;
  account?: AccountService;
  content?: { service: ContentService; actors: ActorResolver; reports?: ReportService };
  identity?: IdentityService;
  profile?: ProfileService;
  logger?: boolean;
  http?: HttpHardening;
}

export interface HttpHardening {
  production?: boolean;
  trustProxyHops?: number;
  rateLimit?: RateLimitOptions | false;
}

export function buildApp(deps: AppDeps) {
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

  app.get("/health", async () => ({ status: "ok" }));

  registerAuthRoutes(app, deps.auth);
  if (deps.account) registerAccountRoutes(app, deps.account);
  if (deps.identity) registerIdentityRoutes(app, deps.identity);
  if (deps.profile) registerProfileRoutes(app, deps.profile);
  if (deps.content) registerContentRoutes(app, deps.content.service, deps.content.actors, deps.content.reports);

  return app;
}
