import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildSupportInfo } from "../src/moderation/crisis.js";

const here = dirname(fileURLToPath(import.meta.url));
const example = readFileSync(join(here, "../../../deploy/env.api.example"), "utf8");

// The same schema the server applies at start-up.
const schema = z.array(z.object({ name: z.string().min(1), contact: z.string().min(1) }));

function exampleValue(): string {
  const line = example.split("\n").find((l) => l.startsWith("SUPPORT_RESOURCES_JSON="));
  if (!line) throw new Error("SUPPORT_RESOURCES_JSON is missing from deploy/env.api.example");
  return line.slice("SUPPORT_RESOURCES_JSON=".length);
}

describe("the helplines in the deployment example", () => {
  it("parse with the server's own schema and are not empty", () => {
    const parsed = schema.parse(JSON.parse(exampleValue()));
    expect(parsed.length).toBeGreaterThanOrEqual(1);
  });

  it("keep the contact a plain number so the app can offer a call button", () => {
    for (const r of schema.parse(JSON.parse(exampleValue()))) {
      expect(r.contact, r.name).toMatch(/^\+?[\d\s()-]{3,}$/);
    }
  });

  it("say when a service is not open round the clock", () => {
    const rows = schema.parse(JSON.parse(exampleValue()));
    const befrienders = rows.find((r) => /Befrienders/.test(r.name));
    expect(befrienders?.name).toMatch(/9:00 to 17:00/);
  });

  it("reach the student in the support message", () => {
    const info = buildSupportInfo(schema.parse(JSON.parse(exampleValue())));
    expect(info.resources.length).toBeGreaterThan(0);
    expect(info.message.length).toBeGreaterThan(20);
  });
});
