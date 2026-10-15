import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

export interface RateLimitOptions {
  authPer10Min: number;
  writePerMin: number;
  readPerMin: number;
  uploadPerHour: number;
  failedAuthPer10Min: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitOptions = {
  authPer10Min: 100,
  writePerMin: 120,
  readPerMin: 600,
  uploadPerHour: 60,
  failedAuthPer10Min: 60,
};

export type RouteClass = "exempt" | "auth" | "upload" | "write" | "read";

const MINUTE = 60_000;
const TEN_MINUTES = 10 * MINUTE;
const HOUR = 60 * MINUTE;

export function classify(method: string, rawUrl: string): RouteClass {
  const path = rawUrl.split("?")[0] ?? "";
  if (path === "/health" || path === "/" || path.startsWith("/console")) return "exempt";
  const m = method.toUpperCase();
  if (m === "OPTIONS" || m === "HEAD") return "exempt";
  if (m === "POST" && (path.startsWith("/auth/") || path.startsWith("/appeals/"))) return "auth";
  if (m === "POST" && path === "/photos") return "upload";
  if (m === "GET") return "read";
  return "write";
}

export class FixedWindowLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxKeys = 100_000,
    private readonly now: () => number = Date.now,
  ) {}

  hit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
    const t = this.now();
    let e = this.entries.get(key);
    if (!e || e.resetAt <= t) {
      this.makeRoom(t);
      e = { count: 0, resetAt: t + windowMs };
      this.entries.set(key, e);
    }
    e.count += 1;
    return {
      allowed: e.count <= limit,
      retryAfterSeconds: Math.max(1, Math.ceil((e.resetAt - t) / 1000)),
    };
  }

  count(key: string): number {
    const e = this.entries.get(key);
    return e && e.resetAt > this.now() ? e.count : 0;
  }

  add(key: string, windowMs: number): void {
    const t = this.now();
    const e = this.entries.get(key);
    if (e && e.resetAt > t) {
      e.count += 1;
      return;
    }
    this.makeRoom(t);
    this.entries.set(key, { count: 1, resetAt: t + windowMs });
  }

  retryAfterSeconds(key: string): number {
    const e = this.entries.get(key);
    return e ? Math.max(1, Math.ceil((e.resetAt - this.now()) / 1000)) : 1;
  }

  get size(): number {
    return this.entries.size;
  }

  private makeRoom(t: number): void {
    if (this.entries.size < this.maxKeys) return;
    for (const [k, v] of this.entries) if (v.resetAt <= t) this.entries.delete(k);
    if (this.entries.size < this.maxKeys) return;
    let drop = Math.ceil(this.maxKeys / 10);
    for (const k of this.entries.keys()) {
      this.entries.delete(k);
      drop -= 1;
      if (drop <= 0) break;
    }
  }
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  const t = h.slice("Bearer ".length).trim();
  return t.length > 0 ? t : null;
}

function sessionKey(req: FastifyRequest): string {
  const t = bearer(req);
  if (!t) return `ip:${req.ip}`;
  return `s:${createHash("sha256").update(t).digest("hex").slice(0, 24)}`;
}

export function registerRateLimit(
  app: FastifyInstance,
  options: RateLimitOptions = DEFAULT_RATE_LIMITS,
  limiter: FixedWindowLimiter = new FixedWindowLimiter(),
): FixedWindowLimiter {
  const reject = (reply: import("fastify").FastifyReply, retryAfter: number) =>
    reply
      .code(429)
      .header("retry-after", String(retryAfter))
      .header("cache-control", "no-store")
      .send({
        error: "rate_limited",
        message: "Too many requests. Please wait a moment and try again.",
      });

  app.addHook("onRequest", async (req, reply) => {
    const cls = classify(req.method, req.url);
    if (cls === "exempt") return;

    const failKey = `fail:${req.ip}`;
    if (limiter.count(failKey) >= options.failedAuthPer10Min) {
      return reject(reply, limiter.retryAfterSeconds(failKey));
    }

    let key: string;
    let limit: number;
    let windowMs: number;
    switch (cls) {
      case "auth":
        key = `auth:${req.ip}`;
        limit = options.authPer10Min;
        windowMs = TEN_MINUTES;
        break;
      case "upload":
        key = `upload:${sessionKey(req)}`;
        limit = options.uploadPerHour;
        windowMs = HOUR;
        break;
      case "write":
        key = `write:${sessionKey(req)}`;
        limit = options.writePerMin;
        windowMs = MINUTE;
        break;
      default:
        key = `read:${sessionKey(req)}`;
        limit = options.readPerMin;
        windowMs = MINUTE;
    }

    const r = limiter.hit(key, limit, windowMs);
    if (!r.allowed) return reject(reply, r.retryAfterSeconds);
  });

  app.addHook("onResponse", async (req, reply) => {
    if (reply.statusCode === 401 && classify(req.method, req.url) !== "exempt") {
      limiter.add(`fail:${req.ip}`, TEN_MINUTES);
    }
  });

  return limiter;
}

export function registerSecurityHeaders(app: FastifyInstance, opts: { production: boolean }): void {
  app.addHook("onSend", async (_req, reply, payload) => {
    const set = (name: string, value: string) => {
      if (reply.getHeader(name) === undefined) reply.header(name, value);
    };
    set("x-content-type-options", "nosniff");
    set("referrer-policy", "no-referrer");
    set("x-frame-options", "DENY");
    set("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    set("cache-control", "no-store");
    set("cross-origin-resource-policy", "same-origin");
    if (opts.production) set("strict-transport-security", "max-age=15552000");
    return payload;
  });
}
