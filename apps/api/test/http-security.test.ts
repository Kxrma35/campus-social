import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { buildAdminApp } from "../src/admin/app.js";
import { buildApp } from "../src/app.js";
import type { AuthService } from "../src/auth/service.js";
import { ApiError } from "../src/errors.js";
import type { AdminService } from "../src/admin/service.js";
import type { PhotoStore } from "../src/content/photos.js";
import {
  classify,
  DEFAULT_RATE_LIMITS,
  FixedWindowLimiter,
  registerRateLimit,
  registerSecurityHeaders,
  type RateLimitOptions,
} from "../src/security/http.js";

describe("route classes", () => {
  it.each([
    ["GET", "/health", "exempt"],
    ["GET", "/console/app.js", "exempt"],
    ["OPTIONS", "/posts", "exempt"],
    ["POST", "/auth/signup/request", "auth"],
    ["POST", "/auth/login/verify", "auth"],
    ["POST", "/appeals/submit", "auth"],
    ["POST", "/photos", "upload"],
    ["POST", "/posts", "write"],
    ["PUT", "/posts/1/reaction", "write"],
    ["DELETE", "/posts/1", "write"],
    ["PATCH", "/me/profile", "write"],
    ["POST", "/account/close/request", "write"],
    ["GET", "/feed?cursor=x", "read"],
    ["GET", "/photos/abc", "read"],
  ])("%s %s is %s", (method, url, expected) => {
    expect(classify(method, url)).toBe(expected);
  });
});

describe("FixedWindowLimiter", () => {
  it("allows up to the limit, refuses after, and starts a new window", () => {
    let t = 1_000;
    const l = new FixedWindowLimiter(100, () => t);
    for (let i = 0; i < 3; i += 1) expect(l.hit("k", 3, 60_000).allowed).toBe(true);
    const over = l.hit("k", 3, 60_000);
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSeconds).toBeGreaterThan(0);
    expect(over.retryAfterSeconds).toBeLessThanOrEqual(60);
    t += 60_001;
    expect(l.hit("k", 3, 60_000).allowed).toBe(true);
  });

  it("keeps keys apart", () => {
    const l = new FixedWindowLimiter();
    expect(l.hit("a", 1, 1000).allowed).toBe(true);
    expect(l.hit("a", 1, 1000).allowed).toBe(false);
    expect(l.hit("b", 1, 1000).allowed).toBe(true);
  });

  it("stays within its memory bound under a flood of distinct keys", () => {
    const l = new FixedWindowLimiter(1000);
    for (let i = 0; i < 50_000; i += 1) l.hit(`ip:${i}`, 5, 60_000);
    expect(l.size).toBeLessThanOrEqual(1000);
  });
});

const tight: RateLimitOptions = {
  authPer10Min: 3,
  writePerMin: 2,
  readPerMin: 4,
  uploadPerHour: 1,
  failedAuthPer10Min: 3,
};

function app(options: RateLimitOptions = tight, trustHops = 0) {
  const a = Fastify({
    logger: false,
    trustProxy: trustHops > 0 ? (_x: string, hop: number) => hop < trustHops : false,
  });
  registerRateLimit(a, options);
  a.get("/health", async () => ({ ok: true }));
  a.get("/feed", async () => ({ items: [] }));
  a.post("/posts", async () => ({ ok: true }));
  a.post("/photos", async () => ({ ok: true }));
  a.post("/auth/login/request", async () => ({ ok: true }));
  a.get("/me", async (req, reply) => {
    if (req.headers.authorization === "Bearer good") return { me: true };
    return reply.code(401).send({ error: "unauthorized", message: "Sign in." });
  });
  return a;
}

const ip = (a: string) => ({ remoteAddress: a });

describe("rate limits", () => {
  it("refuses the request after the limit with 429, a Retry-After and a plain message", async () => {
    const a = app();
    for (let i = 0; i < 3; i += 1) {
      expect((await a.inject({ method: "POST", url: "/auth/login/request", ...ip("1.1.1.1") })).statusCode).toBe(200);
    }
    const res = await a.inject({ method: "POST", url: "/auth/login/request", ...ip("1.1.1.1") });
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(res.json()).toEqual({
      error: "rate_limited",
      message: "Too many requests. Please wait a moment and try again.",
    });
  });

  it("limits sign-in endpoints per address, so one address cannot try many emails", async () => {
    const a = app();
    for (let i = 0; i < 3; i += 1) await a.inject({ method: "POST", url: "/auth/login/request", ...ip("1.1.1.1") });
    expect((await a.inject({ method: "POST", url: "/auth/login/request", ...ip("1.1.1.1") })).statusCode).toBe(429);
    expect((await a.inject({ method: "POST", url: "/auth/login/request", ...ip("2.2.2.2") })).statusCode).toBe(200);
  });

  it("limits signed-in traffic per session, so students sharing one campus address do not block each other", async () => {
    const a = app();
    const post = (token: string) =>
      a.inject({ method: "POST", url: "/posts", headers: { authorization: `Bearer ${token}` }, ...ip("10.0.0.1") });
    expect((await post("alice")).statusCode).toBe(200);
    expect((await post("alice")).statusCode).toBe(200);
    expect((await post("alice")).statusCode).toBe(429);
    expect((await post("bob")).statusCode).toBe(200);
    expect((await post("bob")).statusCode).toBe(200);
    expect((await post("bob")).statusCode).toBe(429);
  });

  it("counts uploads separately from other writes", async () => {
    const a = app();
    const h = { authorization: "Bearer alice" };
    expect((await a.inject({ method: "POST", url: "/photos", headers: h, ...ip("1.1.1.1") })).statusCode).toBe(200);
    expect((await a.inject({ method: "POST", url: "/photos", headers: h, ...ip("1.1.1.1") })).statusCode).toBe(429);
    expect((await a.inject({ method: "POST", url: "/posts", headers: h, ...ip("1.1.1.1") })).statusCode).toBe(200);
  });

  it("never limits the health check", async () => {
    const a = app();
    for (let i = 0; i < 50; i += 1) {
      expect((await a.inject({ method: "GET", url: "/health", ...ip("1.1.1.1") })).statusCode).toBe(200);
    }
  });

  it("throttles an address that keeps presenting bad tokens", async () => {
    const a = app();
    for (let i = 0; i < 3; i += 1) {
      const r = await a.inject({ method: "GET", url: "/me", headers: { authorization: "Bearer guess" }, ...ip("9.9.9.9") });
      expect(r.statusCode).toBe(401);
    }
    const blocked = await a.inject({ method: "GET", url: "/me", headers: { authorization: "Bearer good" }, ...ip("9.9.9.9") });
    expect(blocked.statusCode).toBe(429);
    const other = await a.inject({ method: "GET", url: "/me", headers: { authorization: "Bearer good" }, ...ip("8.8.8.8") });
    expect(other.statusCode).toBe(200);
  });

  it("ignores a forged forwarding header unless a proxy is trusted", async () => {
    const direct = app();
    const forge = (n: number) => ({
      method: "POST" as const,
      url: "/auth/login/request",
      headers: { "x-forwarded-for": `203.0.113.${n}` },
      ...ip("5.5.5.5"),
    });
    for (let i = 1; i <= 3; i += 1) await direct.inject(forge(i));
    expect((await direct.inject(forge(4))).statusCode).toBe(429);

    const behindProxy = app(tight, 1);
    for (let i = 1; i <= 3; i += 1) await behindProxy.inject(forge(1));
    expect((await behindProxy.inject(forge(1))).statusCode).toBe(429);
    expect((await behindProxy.inject(forge(2))).statusCode).toBe(200);
  });

  it("ships limits that a normal student session never reaches", () => {
    expect(DEFAULT_RATE_LIMITS.readPerMin).toBeGreaterThanOrEqual(300);
    expect(DEFAULT_RATE_LIMITS.writePerMin).toBeGreaterThanOrEqual(60);
  });
});

describe("security headers", () => {
  const build = (production: boolean) => {
    const a = Fastify({ logger: false });
    registerSecurityHeaders(a, { production });
    a.get("/json", async () => ({ ok: true }));
    a.get("/image", async (_r, reply) => reply.header("cache-control", "private, max-age=300").send("x"));
    a.get("/page", async (_r, reply) =>
      reply.header("content-security-policy", "default-src 'self'").header("content-type", "text/html").send("<p>x</p>"),
    );
    return a;
  };

  it("sets the hardening headers on responses, errors and unknown routes", async () => {
    const a = build(false);
    for (const url of ["/json", "/nope"]) {
      const res = await a.inject({ method: "GET", url });
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    }
  });

  it("does not override a route's own cache or security policy", async () => {
    const a = build(false);
    expect((await a.inject({ method: "GET", url: "/image" })).headers["cache-control"]).toBe("private, max-age=300");
    expect((await a.inject({ method: "GET", url: "/page" })).headers["content-security-policy"]).toBe("default-src 'self'");
  });

  it("sends HSTS only in production", async () => {
    expect((await build(false).inject({ method: "GET", url: "/json" })).headers["strict-transport-security"]).toBeUndefined();
    expect((await build(true).inject({ method: "GET", url: "/json" })).headers["strict-transport-security"]).toBe("max-age=15552000");
  });
});

describe("both services use them", () => {
  it("the student API sends the headers and limits sign-in per address", async () => {
    const a = buildApp({
      auth: { requestSignup: async () => undefined, requestLogin: async () => undefined } as unknown as AuthService,
      logger: false,
      http: { production: true, rateLimit: { ...DEFAULT_RATE_LIMITS, authPer10Min: 2 } },
    });
    const h = await a.inject({ method: "GET", url: "/health" });
    expect(h.headers["x-content-type-options"]).toBe("nosniff");
    expect(h.headers["strict-transport-security"]).toBeDefined();

    const call = () =>
      a.inject({ method: "POST", url: "/auth/login/request", payload: { email: "a@test.ac.ke" }, remoteAddress: "7.7.7.7" });
    expect((await call()).statusCode).toBeLessThan(300);
    expect((await call()).statusCode).toBeLessThan(300);
    expect((await call()).statusCode).toBe(429);
  });

  it("the admin service keeps the console's own policy and throttles bad moderator tokens", async () => {
    const a = buildAdminApp({
      admin: {
        authenticate: async () => {
          throw new ApiError("unauthorized", 401, "Invalid moderator token.");
        },
      } as unknown as AdminService,
      photos: {} as PhotoStore,
      logger: false,
      http: { rateLimit: { ...DEFAULT_RATE_LIMITS, failedAuthPer10Min: 2 } },
    });
    const page = await a.inject({ method: "GET", url: "/console" });
    expect(page.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(page.headers["x-content-type-options"]).toBe("nosniff");

    const bad = () =>
      a.inject({ method: "GET", url: "/admin/queue", headers: { authorization: "Bearer nope" }, remoteAddress: "6.6.6.6" });
    const first = await bad();
    const second = await bad();
    expect([first.statusCode, second.statusCode]).not.toContain(429);
    expect((await bad()).statusCode).toBe(429);
  });
});

describe("malformed requests", () => {
  const student = () =>
    buildApp({
      auth: { requestLogin: async () => undefined } as unknown as AuthService,
      logger: false,
    });

  it("answers a body that is missing for its content type with 400, not a server error", async () => {
    const res = await student().inject({
      method: "POST",
      url: "/auth/login/request",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "bad_request", message: "The request could not be read." });
  });

  it("answers broken JSON with 400 and an oversized body with 413", async () => {
    const a = student();
    const broken = await a.inject({
      method: "POST",
      url: "/auth/login/request",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(broken.statusCode).toBe(400);

    const big = await a.inject({
      method: "POST",
      url: "/auth/login/request",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email: "a@test.ac.ke", pad: "x".repeat(200 * 1024) }),
    });
    expect(big.statusCode).toBe(413);
    expect(big.json().error).toBe("payload_too_large");
  });

  it("still reports a real fault as a 500 with no detail", async () => {
    const a = buildApp({
      auth: {
        requestLogin: async () => {
          throw new Error("secret detail");
        },
      } as unknown as AuthService,
      logger: false,
    });
    const res = await a.inject({
      method: "POST",
      url: "/auth/login/request",
      payload: { email: "a@test.ac.ke" },
    });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.json())).not.toContain("secret detail");
  });
});
