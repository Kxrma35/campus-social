import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { ProfileService } from "../profile/service.js";

const patchBody = z
  .object({
    displayName: z.string().max(200).optional(),
    course: z.string().max(400).nullable().optional(),
    studyYear: z.number().int().nullable().optional(),
  })
  .strict()
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: "Send at least one field to change.",
  });

function token(req: FastifyRequest): string {
  const h = req.headers.authorization;
  const t = h?.startsWith("Bearer ") ? h.slice("Bearer ".length).trim() : "";
  if (!t) throw new ApiError("unauthorized", 401, "Sign in to continue.");
  return t;
}

export function registerProfileRoutes(app: FastifyInstance, profile: ProfileService): void {
  app.get("/me/profile", async (req, reply) => {
    return reply.header("cache-control", "no-store").send(await profile.get(token(req)));
  });

  app.patch("/me/profile", async (req, reply) => {
    const body = patchBody.parse(req.body);
    const out = await profile.update(token(req), body);
    return reply.header("cache-control", "no-store").send(out);
  });
}
