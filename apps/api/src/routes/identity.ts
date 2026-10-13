import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { IdentityService } from "../identity/service.js";

const createBody = z.object({
  acknowledged: z.boolean(),
});

function token(req: FastifyRequest): string {
  const h = req.headers.authorization;
  const t = h?.startsWith("Bearer ") ? h.slice("Bearer ".length).trim() : "";
  if (!t) throw new ApiError("unauthorized", 401, "Sign in to continue.");
  return t;
}

export function registerIdentityRoutes(app: FastifyInstance, identity: IdentityService): void {
  // Only ever returns the caller's own profiles.
  app.get("/me/profiles", async (req, reply) => {
    return reply.header("cache-control", "no-store").send(await identity.myProfiles(token(req)));
  });

  app.post("/profiles/anonymous", async (req, reply) => {
    const body = createBody.parse(req.body);
    const out = await identity.createAnonymous(token(req), body);
    return reply.code(201).header("cache-control", "no-store").send(out);
  });
}
