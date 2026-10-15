import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";

const FILES = {
  "/console": { file: "index.html", type: "text/html; charset=utf-8" },
  "/console/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/console/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
} as const;

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function registerConsole(app: FastifyInstance): void {
  for (const [path, spec] of Object.entries(FILES)) {
    const body = readFileSync(new URL(`./console/${spec.file}`, import.meta.url), "utf8");
    app.get(path, async (_req, reply) =>
      reply
        .header("content-type", spec.type)
        .header("content-security-policy", CSP)
        .header("x-content-type-options", "nosniff")
        .header("x-frame-options", "DENY")
        .header("referrer-policy", "no-referrer")
        .header("cache-control", "no-store")
        .send(body),
    );
  }
  app.get("/", async (_req, reply) => reply.redirect("/console"));
}
