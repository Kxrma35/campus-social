import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthError, type AuthService } from "../auth/service.js";

const email = z.string().trim().max(254).email();
const code = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code");

const signupRequest = z.object({ email });

const signupVerify = z.object({
  email,
  code,
  dateOfBirth: z.string(),
  confirmAge18: z.literal(true),
  acceptTerms: z.literal(true),
  displayName: z.string().trim().min(1).max(80),
  course: z.string().trim().max(120).nullish(),
  studyYear: z.number().int().min(1).max(8).nullish(),
  deviceLabel: z.string().trim().max(80).nullish(),
});

const appealSubmit = z.object({ email, code, message: z.string().max(5000) });
const loginRequest = z.object({ email });
const loginVerify = z.object({
  email,
  code,
  deviceLabel: z.string().trim().max(80).nullish(),
});

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  const token = h.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService): void {
  const CODE_SENT = { status: "code_sent_if_eligible" } as const;

  app.post("/auth/signup/request", async (req, reply) => {
    const body = signupRequest.parse(req.body);
    await auth.requestSignup(body.email);
    return reply.code(202).send(CODE_SENT);
  });

  app.post("/auth/signup/verify", async (req, reply) => {
    const body = signupVerify.parse(req.body);
    const session = await auth.verifySignup(body);
    return reply.code(201).send(session);
  });

  app.post("/auth/login/request", async (req, reply) => {
    const body = loginRequest.parse(req.body);
    await auth.requestLogin(body.email);
    return reply.code(202).send(CODE_SENT);
  });

  app.post("/auth/login/verify", async (req) => {
    const body = loginVerify.parse(req.body);
    return auth.verifyLogin(body.email, body.code, body.deviceLabel);
  });

  app.post("/appeals/request", async (req, reply) => {
    const body = signupRequest.parse(req.body);
    await auth.requestAppeal(body.email);
    return reply.code(202).send(CODE_SENT);
  });

  app.post("/appeals/submit", async (req, reply) => {
    const body = appealSubmit.parse(req.body);
    await auth.submitAppeal(body.email, body.code, body.message);
    return reply.code(201).send({ status: "received" });
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = bearer(req);
    if (token) await auth.logout(token);
    return reply.code(204).send();
  });

  app.get("/me", async (req) => {
    const token = bearer(req);
    if (!token) throw new AuthError("unauthorized", 401, "Sign in to continue.");
    const ctx = await auth.authenticate(token);
    return {
      account: { id: ctx.accountId, status: ctx.status },
      profile: { id: ctx.knownProfileId },
    };
  });
}
