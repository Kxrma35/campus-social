import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { buildAdminApp } from "../src/admin/app.js";
import type { AdminService } from "../src/admin/service.js";
import type { PhotoStore } from "../src/content/photos.js";

const dir = new URL("../src/admin/console/", import.meta.url);
const html = readFileSync(new URL("index.html", dir), "utf8");
const js = readFileSync(new URL("app.js", dir), "utf8");

describe("console routes", () => {
  const app = buildAdminApp({ admin: {} as AdminService, photos: {} as PhotoStore, logger: false });

  it("serves the three files without a token and with the right types", async () => {
    const page = await app.inject({ method: "GET", url: "/console" });
    const script = await app.inject({ method: "GET", url: "/console/app.js" });
    const css = await app.inject({ method: "GET", url: "/console/app.css" });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(script.headers["content-type"]).toContain("text/javascript");
    expect(css.headers["content-type"]).toContain("text/css");
    expect(page.body).toBe(html);
  });

  it("sends a strict content security policy and hardening headers", async () => {
    const res = await app.inject({ method: "GET", url: "/console" });
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("sends the visitor from the root to the console", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/console");
  });

  it("leaves the data routes protected", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/queue" });
    expect(res.statusCode).toBe(401);
  });
});

describe("console source rules", () => {
  it("has no inline script, style or event handler that the policy would block", () => {
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it("never writes data into the page as markup", () => {
    for (const banned of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "setAttribute(\"style\"", "srcdoc"]) {
      expect(js, banned).not.toContain(banned);
    }
  });

  it("keeps the hidden attribute working and gives the danger button its own readable text colour", () => {
    const css = readFileSync(new URL("app.css", dir), "utf8");
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
    expect(css).toMatch(/button\.danger\s*\{[^}]*color:\s*var\(--danger-fg\)/);
    const defs = css.match(/--danger-fg:/g) ?? [];
    expect(defs.length).toBeGreaterThanOrEqual(2);
  });

  it("loads nothing from another origin", () => {
    expect(js + html).not.toMatch(/https?:\/\//);
  });
});

interface Reply {
  status?: number;
  body?: unknown;
  blob?: string;
}

function setup(routes: Record<string, Reply | ((init: RequestInit) => Reply)>, initialToken: string | null = null) {
  const dom = new JSDOM(html, { url: "http://localhost:3100/console", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const calls: { method: string; path: string; headers: Record<string, string>; body: unknown }[] = [];
  const blobUrls: string[] = [];

  (window as unknown as { URL: { createObjectURL: (b: unknown) => string; revokeObjectURL: (u: string) => void } }).URL.createObjectURL = () => {
    const u = `blob:photo-${blobUrls.length}`;
    blobUrls.push(u);
    return u;
  };
  (window as unknown as { URL: { revokeObjectURL: (u: string) => void } }).URL.revokeObjectURL = () => undefined;

  (window as unknown as { fetch: unknown }).fetch = async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method, path: url, headers, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    const route = routes[`${method} ${url.split("?")[0]}`];
    const r = typeof route === "function" ? route(init) : route ?? { status: 404, body: { error: "not_found", message: "Not found." } };
    const status = r.status ?? 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => (r.body === undefined ? "" : JSON.stringify(r.body)),
      blob: async () => r.blob ?? "bytes",
    };
  };

  if (initialToken) window.sessionStorage.setItem("campus_mod_token", initialToken);
  window.eval(js);
  return { window, document: window.document, calls, blobUrls };
}

async function until(cond: () => boolean, label = "condition") {
  for (let i = 0; i < 100; i += 1) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const text = (d: Document) => d.body.textContent ?? "";
const byText = (d: Document, sel: string, t: string) =>
  [...d.querySelectorAll<HTMLElement>(sel)].find((n) => (n.textContent ?? "").includes(t));

const queueItem = (over: Record<string, unknown> = {}) => ({
  targetKind: "post",
  targetId: "11111111-1111-4111-8111-111111111111",
  urgent: false,
  overdue: false,
  userReports: 2,
  autoFlags: 0,
  reasons: { harassment: 2 },
  oldestReportAt: "2026-10-13T08:00:00.000Z",
  dueAt: "2026-10-14T08:00:00.000Z",
  preview: {
    text: "a reported post",
    authorProfileId: "22222222-2222-4222-8222-222222222222",
    authorKind: "known",
    authorHandle: "jane_doe_4821",
    authorDisplayName: "Jane Doe",
    hidden: false,
    hiddenReason: null,
    deleted: false,
  },
  ...over,
});

const target = (over: Record<string, unknown> = {}) => ({
  targetKind: "post",
  targetId: "11111111-1111-4111-8111-111111111111",
  preview: queueItem().preview,
  photos: [],
  postId: "11111111-1111-4111-8111-111111111111",
  reports: [
    { id: "r1", reason: "harassment", detail: "keeps targeting me", source: "user", status: "open", createdAt: "2026-10-13T08:00:00.000Z", resolvedAt: null, resolvedBy: null },
  ],
  actions: [],
  ...over,
});

describe("sign in", () => {
  it("asks for a token and says plainly when it is not recognised", async () => {
    const { document, calls } = setup({
      "GET /admin/queue": { status: 401, body: { error: "unauthorized", message: "Invalid moderator token." } },
    });
    expect(document.querySelector("label")?.textContent).toContain("Moderator token");
    (document.querySelector("#token") as HTMLInputElement).value = "wrong";
    document.querySelector("form")!.dispatchEvent(new document.defaultView!.Event("submit", { cancelable: true }));
    await until(() => text(document).includes("not recognised"), "error message");
    expect(calls[0]!.headers.authorization).toBe("Bearer wrong");
    expect(document.querySelector("#token")).toBeTruthy();
    expect(document.defaultView!.sessionStorage.getItem("campus_mod_token")).toBeNull();
  });

  it("signs in, remembers the token for the tab only, and signs out", async () => {
    const { document, window } = setup({
      "GET /admin/queue": { body: { items: [] } },
    });
    (document.querySelector("#token") as HTMLInputElement).value = "good_token";
    document.querySelector("form")!.dispatchEvent(new window.Event("submit", { cancelable: true }));
    await until(() => text(document).includes("Nothing to review"), "empty queue");
    expect(window.sessionStorage.getItem("campus_mod_token")).toBe("good_token");
    byText(document, "button", "Sign out")!.click();
    await until(() => !!document.querySelector("#token"), "login form");
    expect(window.sessionStorage.getItem("campus_mod_token")).toBeNull();
  });

  it("returns to sign in when the token is revoked mid session", async () => {
    const { document } = setup(
      { "GET /admin/queue": { status: 401, body: { error: "unauthorized", message: "Invalid moderator token." } } },
      "old_token",
    );
    await until(() => text(document).includes("Your session ended"), "session ended message");
    expect(document.querySelector("#token")).toBeTruthy();
  });
});

describe("report queue", () => {
  it("shows urgency and overdue in words, who wrote it, and what was said", async () => {
    const { document } = setup(
      {
        "GET /admin/queue": {
          body: {
            items: [
              queueItem({ urgent: true, overdue: true, reasons: { self_harm: 1 }, userReports: 0, autoFlags: 1 }),
              queueItem({
                targetId: "33333333-3333-4333-8333-333333333333",
                preview: { ...queueItem().preview, authorKind: "anonymous", authorHandle: "quiet_fox_1234", authorDisplayName: null, text: "an anonymous one" },
              }),
            ],
          },
        },
      },
      "tok",
    );
    await until(() => text(document).includes("a reported post"), "queue");
    const t = text(document);
    expect(t).toContain("Urgent");
    expect(t).toContain("Overdue");
    expect(t).toContain("@jane_doe_4821 (Jane Doe)");
    expect(t).toContain("Anonymous profile @quiet_fox_1234");
    expect(t).toContain("self harm x1");
    expect(t).toContain("0 reports, 1 automatic flag.");
  });

  it("shows hostile content as plain text and never as markup", async () => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
    const { document, window } = setup(
      {
        "GET /admin/queue": {
          body: { items: [queueItem({ preview: { ...queueItem().preview, text: evil, authorDisplayName: evil } })] },
        },
      },
      "tok",
    );
    await until(() => text(document).includes("<img src=x"), "hostile text rendered");
    expect(document.querySelectorAll("#app img").length).toBe(0);
    expect(document.querySelectorAll("#app script").length).toBe(0);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("opens an item with its reports, and loads photos with the token and shows the author's description", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const { document, calls, blobUrls } = setup(
      {
        "GET /admin/queue": { body: { items: [queueItem()] } },
        [`GET /admin/targets/post/${id}`]: {
          body: target({
            photos: [
              { uploadId: "44444444-4444-4444-8444-444444444444", width: 80, height: 60, altText: "A red bicycle" },
              { uploadId: "55555555-5555-4555-8555-555555555555", width: 80, height: 60, altText: null },
            ],
          }),
        },
        "GET /admin/photos/44444444-4444-4444-8444-444444444444": { blob: "jpeg" },
        "GET /admin/photos/55555555-5555-4555-8555-555555555555": { status: 404, body: { error: "not_found", message: "Not found." } },
      },
      "tok",
    );
    await until(() => !!byText(document, "button", "Review"), "review button");
    byText(document, "button", "Review")!.click();
    await until(() => text(document).includes("keeps targeting me"), "target detail");

    await until(() => blobUrls.length === 1, "photo fetched");
    const photoCall = calls.find((c) => c.path === "/admin/photos/44444444-4444-4444-8444-444444444444")!;
    expect(photoCall.headers.authorization).toBe("Bearer tok");
    const imgs = [...document.querySelectorAll("img")];
    expect(imgs[0]!.getAttribute("alt")).toBe("A red bicycle");
    expect(imgs[1]!.getAttribute("alt")).toContain("no description written by the author");
    await until(() => text(document).includes("This photo could not be loaded."), "failed photo message");
    expect(text(document)).toContain("Author's description: A red bicycle");
  });
});

describe("resolving reports", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const open = async (extra: Record<string, Reply | ((i: RequestInit) => Reply)> = {}) => {
    const s = setup(
      {
        "GET /admin/queue": { body: { items: [queueItem()] } },
        [`GET /admin/targets/post/${id}`]: { body: target() },
        ...extra,
      },
      "tok",
    );
    await until(() => !!byText(s.document, "button", "Review"), "review button");
    byText(s.document, "button", "Review")!.click();
    await until(() => !!s.document.querySelector('form[aria-label="Resolve reports"]'), "resolve form");
    return s;
  };

  it("needs an outcome, then an explicit confirmation, before anything is sent", async () => {
    const { document, window, calls } = await open({
      [`POST /admin/targets/post/${id}/resolve`]: { body: { reportsClosed: 2, contentHidden: true, contentRestored: false } },
    });
    const form = document.querySelector('form[aria-label="Resolve reports"]') as HTMLFormElement;
    form.dispatchEvent(new window.Event("submit", { cancelable: true }));
    expect(text(document)).toContain("Choose an outcome first.");

    (form.querySelector('input[value="uphold"]') as HTMLInputElement).checked = true;
    (form.querySelector("textarea") as HTMLTextAreaElement).value = "  clear targeting  ";
    form.dispatchEvent(new window.Event("submit", { cancelable: true }));
    expect(text(document)).toContain("keeps the content hidden");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);

    byText(document, "button", "Cancel")!.click();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);

    form.dispatchEvent(new window.Event("submit", { cancelable: true }));
    byText(document, "button", "Yes, resolve")!.click();
    await until(() => calls.some((c) => c.method === "POST"), "resolve request");
    const sent = calls.find((c) => c.method === "POST")!;
    expect(sent.path).toBe(`/admin/targets/post/${id}/resolve`);
    expect(sent.body).toEqual({ outcome: "uphold", note: "clear targeting" });
    await until(() => text(document).includes("Reports waiting for review"), "back to the queue");
  });

  it("shows the server's message and stays on the item when resolving fails", async () => {
    const { document, window } = await open({
      [`POST /admin/targets/post/${id}/resolve`]: { status: 404, body: { error: "not_found", message: "Not found." } },
    });
    const form = document.querySelector('form[aria-label="Resolve reports"]') as HTMLFormElement;
    (form.querySelector('input[value="dismiss"]') as HTMLInputElement).checked = true;
    form.dispatchEvent(new window.Event("submit", { cancelable: true }));
    byText(document, "button", "Yes, resolve")!.click();
    await until(() => text(document).includes("Not found."), "error shown");
    expect(document.querySelector('form[aria-label="Resolve reports"]')).toBeTruthy();
  });
});

describe("penalties", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const profileId = "22222222-2222-4222-8222-222222222222";
  const open = async (preview = queueItem().preview, extra: Record<string, Reply> = {}) => {
    const s = setup(
      {
        "GET /admin/queue": { body: { items: [queueItem()] } },
        [`GET /admin/targets/post/${id}`]: { body: target({ preview }) },
        ...extra,
      },
      "tok",
    );
    await until(() => !!byText(s.document, "button", "Review"), "review button");
    byText(s.document, "button", "Review")!.click();
    await until(() => !!s.document.querySelector('form[aria-label="Penalise the author"]'), "penalty form");
    return s;
  };
  const submit = (d: Document, w: Window) =>
    (d.querySelector('form[aria-label="Penalise the author"]') as HTMLFormElement).dispatchEvent(new w.Event("submit", { cancelable: true }));

  it("requires a reason and, for a suspension, a sensible end date", async () => {
    const { document, window, calls } = await open();
    const form = document.querySelector('form[aria-label="Penalise the author"]') as HTMLFormElement;

    submit(document, window as unknown as Window);
    expect(text(document)).toContain("Choose a penalty first.");

    const suspension = form.querySelector('input[value="suspension"]') as HTMLInputElement;
    suspension.checked = true;
    suspension.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect((document.querySelector("#pen-ends")!.parentElement as HTMLElement).hidden).toBe(false);

    submit(document, window as unknown as Window);
    expect(text(document)).toContain("at least 10 characters");

    (form.querySelector("textarea") as HTMLTextAreaElement).value = "repeated targeting after a warning";
    submit(document, window as unknown as Window);
    expect(text(document)).toContain("Choose when the suspension ends.");

    (document.querySelector("#pen-ends") as HTMLInputElement).value = "2020-01-01T10:00";
    submit(document, window as unknown as Window);
    expect(text(document)).toContain("between 1 hour and 30 days");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("sends a ban against the author's profile only after confirmation", async () => {
    const { document, window, calls } = await open(undefined, {
      [`POST /admin/profiles/${profileId}/penalties`]: { status: 201, body: { status: "applied" } },
    });
    const form = document.querySelector('form[aria-label="Penalise the author"]') as HTMLFormElement;
    (form.querySelector('input[value="ban"]') as HTMLInputElement).checked = true;
    (form.querySelector("textarea") as HTMLTextAreaElement).value = "  Sustained harassment after two warnings  ";
    submit(document, window as unknown as Window);
    expect(text(document)).toContain("strongest action available");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);

    byText(document, "button", "Yes, apply penalty")!.click();
    await until(() => calls.some((c) => c.method === "POST"), "penalty request");
    const sent = calls.find((c) => c.method === "POST")!;
    expect(sent.path).toBe(`/admin/profiles/${profileId}/penalties`);
    expect(sent.body).toEqual({ kind: "ban", note: "Sustained harassment after two warnings" });
    await until(() => text(document).includes("has been applied and recorded"), "confirmation");
  });

  it("tells the moderator that an anonymous penalty lands on an account they cannot see", async () => {
    const { document } = await open({
      ...queueItem().preview,
      authorKind: "anonymous",
      authorHandle: "quiet_fox_1234",
      authorDisplayName: null,
    });
    expect(text(document)).toContain("you will not see who that is");
  });
});

describe("appeals", () => {
  const appealId = "66666666-6666-4666-8666-666666666666";
  const open = {
    id: appealId,
    message: "I was reported by someone angry.\nPlease look again.",
    status: "open",
    createdAt: "2026-10-12T09:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    decisionNote: null,
  };

  async function goToAppeals(routes: Record<string, Reply> = {}) {
    const s = setup(
      {
        "GET /admin/queue": { body: { items: [] } },
        "GET /admin/appeals": { body: { items: [open] } },
        ...routes,
      },
      "tok",
    );
    await until(() => !!byText(s.document, "button", "Appeals"), "nav");
    byText(s.document, "nav button", "Appeals")!.click();
    await until(() => text(s.document).includes("I was reported by someone angry."), "appeal listed");
    return s;
  }

  it("shows the student's message and the decision needs a reason and a confirmation", async () => {
    const { document, window, calls } = await goToAppeals({
      [`POST /admin/appeals/${appealId}/decision`]: { body: { status: "decided" } },
    });
    const form = document.querySelector('form[aria-label="Decide this appeal"]') as HTMLFormElement;
    form.dispatchEvent(new window.Event("submit", { cancelable: true }));
    expect(text(document)).toContain("Choose a decision first.");

    (form.querySelector('input[value="denied"]') as HTMLInputElement).checked = true;
    form.dispatchEvent(new window.Event("submit", { cancelable: true }));
    expect(text(document)).toContain("at least 10 characters");

    (form.querySelector("textarea") as HTMLTextAreaElement).value = "The reports were corroborated by two witnesses";
    form.dispatchEvent(new window.Event("submit", { cancelable: true }));
    expect(text(document)).toContain("can only be decided once");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);

    byText(document, "button", "Yes, record decision")!.click();
    await until(() => calls.some((c) => c.method === "POST"), "decision request");
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      decision: "denied",
      note: "The reports were corroborated by two witnesses",
    });
  });

  it("lists decided appeals with who decided and why, without a form", async () => {
    const { document, window } = await goToAppeals({
      "GET /admin/appeals": {
        body: {
          items: [{ ...open, status: "denied", decidedAt: "2026-10-13T10:00:00.000Z", decidedBy: "Wanjiru", decisionNote: "Corroborated" }],
        },
      },
    });
    expect(document.querySelector('form[aria-label="Decide this appeal"]')).toBeNull();
    expect(text(document)).toContain("Decided 2026-10-13 10:00 UTC by Wanjiru. Note: Corroborated");
    void window;
  });
});
