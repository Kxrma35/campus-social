import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const full = { DATABASE_URL: "postgres://x", CODE_HMAC_KEY: "k".repeat(32) };

describe("loadConfig", () => {
  it("binds to loopback unless told otherwise", () => {
    expect(loadConfig(full).HOST).toBe("127.0.0.1");
    expect(loadConfig({ ...full, HOST: "0.0.0.0" }).HOST).toBe("0.0.0.0");
  });

  it("lets the admin service and the maintenance job start without the sign-in settings", () => {
    const c = loadConfig({ ADMIN_DATABASE_URL: "postgres://m" });
    expect(c.DATABASE_URL).toBeUndefined();
    expect(c.CODE_HMAC_KEY).toBeUndefined();
  });

  it("still rejects a code key that is set but too short", () => {
    expect(() => loadConfig({ ...full, CODE_HMAC_KEY: "short" })).toThrow();
  });

  it("enforces the moderation retention minimums", () => {
    expect(() => loadConfig({ ...full, RETENTION_DISMISSED_REPORT_DAYS: "29" })).toThrow();
    expect(loadConfig({ ...full, RETENTION_DISMISSED_REPORT_DAYS: "30" }).RETENTION_DISMISSED_REPORT_DAYS).toBe(30);
  });
});
