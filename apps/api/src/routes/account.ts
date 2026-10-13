import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AccountService } from "../account/service.js";
import { AuthError } from "../auth/service.js";

const codeBody = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") });

function token(req: FastifyRequest): string {
  const h = req.headers.authorization;
  const t = h?.startsWith("Bearer ") ? h.slice("Bearer ".length).trim() : "";
  if (!t) throw new AuthError("unauthorized", 401, "Sign in to continue.");
  return t;
}

export function registerAccountRoutes(app: FastifyInstance, account: AccountService): void {
  app.post("/account/reverify/request", async (req, reply) => {
    await account.requestReverify(token(req));
    return reply.code(202).send({ status: "code_sent" });
  });

  app.post("/account/reverify/verify", async (req) => {
    const { code } = codeBody.parse(req.body);
    return account.verifyReverify(token(req), code);
  });

  app.post("/account/close/request", async (req, reply) => {
    await account.requestClose(token(req));
    return reply.code(202).send({ status: "code_sent" });
  });

  app.post("/account/close/confirm", async (req, reply) => {
    const { code } = codeBody.parse(req.body);
    await account.confirmClose(token(req), code);
    return reply.code(204).send();
  });

  app.get("/account/export", async (req, reply) => {
    const data = await account.exportData(token(req));
    return reply
      .header("content-disposition", 'attachment; filename="my-data.json"')
      .header("cache-control", "no-store")
      .send(data);
  });
}
