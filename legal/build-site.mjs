#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const release = args.includes("--release");
const outIdx = args.indexOf("--out");
const outDir = resolve(outIdx >= 0 ? args[outIdx + 1] : join(here, "site-dist"));

const DOCS = [
  { slug: "privacy", file: "PRIVACY_POLICY.md", title: "Privacy policy" },
  { slug: "terms", file: "TERMS_OF_SERVICE.md", title: "Terms of service" },
  { slug: "rules", file: "COMMUNITY_RULES.md", title: "Community rules" },
  { slug: "cookies", file: "COOKIES_AND_TRACKERS.md", title: "Cookies and trackers" },
];

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const PLACEHOLDER = /\[(?![xX ]\])[A-Za-z][^\[\]\n]{1,80}\](?!\()/g;

const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function render(markdown) {
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      // Never pass raw HTML from a source document through.
      html: (token) => escapeHtml(token.text ?? token.raw ?? ""),
      heading(token) {
        const inner = this.parser.parseInline(token.tokens);
        const id = slugify(token.text);
        return `<h${token.depth} id="${id}">${inner}</h${token.depth}>\n`;
      },
      link(token) {
        const inner = this.parser.parseInline(token.tokens);
        return `<a href="${escapeHtml(token.href)}">${inner}</a>`;
      },
    },
  });

  const tokens = md.lexer(markdown);
  const firstHeading = tokens.findIndex((t) => t.type === "heading" && t.depth === 1);
  if (firstHeading >= 0) {
    let i = firstHeading + 1;
    while (i < tokens.length && (tokens[i].type === "blockquote" || tokens[i].type === "space")) {
      tokens.splice(i, 1);
    }
  }
  return { html: md.parser(tokens), text: tokens.map((t) => t.raw ?? "").join("") };
}

const CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#111827;--muted:#4b5563;--line:#d1d5db;--link:#1d4ed8;--note-bg:#fef3c7;--note-fg:#78350f;--note-line:#b45309}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f19;--fg:#f3f4f6;--muted:#c1c7d0;--line:#374151;--link:#93c5fd;--note-bg:#3b2a05;--note-fg:#fde68a;--note-line:#d97706}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:1rem/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:46rem;margin:0 auto;padding:1rem 1rem 3rem}
h1{font-size:1.75rem;line-height:1.25}h2{margin-top:2rem;font-size:1.25rem}h3{font-size:1.1rem}
a{color:var(--link)}a:focus-visible{outline:3px solid var(--link);outline-offset:2px}
table{border-collapse:collapse;display:block;overflow-x:auto;max-width:100%}
th,td{border:1px solid var(--line);padding:.5rem .6rem;text-align:left;vertical-align:top}
blockquote{margin:1rem 0;padding:.25rem 1rem;border-left:4px solid var(--line);color:var(--muted)}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.95em}
.draft{background:var(--note-bg);color:var(--note-fg);border:2px solid var(--note-line);border-radius:.5rem;padding:.75rem 1rem;margin:1rem 0}
nav ul{list-style:none;padding:0}nav li{margin:.5rem 0}
footer{margin-top:3rem;border-top:1px solid var(--line);padding-top:1rem;color:var(--muted);font-size:.9rem}
`;

function page({ title, body, draftNote, footer }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${draftNote ? `<div class="draft" role="note"><strong>Draft.</strong> ${draftNote}</div>` : ""}
${body}
<footer>${footer}</footer>
</main>
</body>
</html>
`;
}

const problems = [];
const built = [];
rmSync(outDir, { recursive: true, force: true });

for (const doc of DOCS) {
  const source = readFileSync(join(here, doc.file), "utf8");
  const rendered = render(source);
  const placeholders = rendered.text.match(PLACEHOLDER) ?? [];
  const version = /DRAFT\s+v(\d+(?:\.\d+)*)/i.exec(source)?.[1] ?? /[Dd]raft\s+v(\d+(?:\.\d+)*)/.exec(source)?.[1] ?? null;
  const isDraft = version !== null || placeholders.length > 0;

  if (release && placeholders.length > 0) {
    problems.push(`${doc.file}: ${placeholders.length} placeholder(s) still to fill in, e.g. ${placeholders.slice(0, 3).join(" ")}`);
  }
  if (release && isDraft) {
    problems.push(`${doc.file}: still marked as a draft${version ? ` (v${version})` : ""}; reviewed text must drop the DRAFT marker first`);
  }

  const note = isDraft
    ? `This document has not been reviewed by a lawyer and is not final${
        placeholders.length ? `; ${placeholders.length} detail${placeholders.length === 1 ? "" : "s"} in [square brackets] still need to be filled in` : ""
      }. Do not rely on it.`
    : "";

  const html = page({
    title: `${doc.title} | Campus Social`,
    body: `<nav aria-label="Policies"><a href="../">All policies</a></nav>\n${rendered.html}`,
    draftNote: note,
    footer: `Source: ${escapeHtml(doc.file)}${version ? `, draft v${escapeHtml(version)}` : ""}.`,
  });
  mkdirSync(join(outDir, doc.slug), { recursive: true });
  writeFileSync(join(outDir, doc.slug, "index.html"), html);
  built.push({ ...doc, draft: isDraft, placeholders: placeholders.length });
}

if (problems.length > 0) {
  rmSync(outDir, { recursive: true, force: true });
  console.error("Refusing to build a release. Not ready to publish:\n  - " + problems.join("\n  - "));
  process.exit(1);
}

const anyDraft = built.some((d) => d.draft);
writeFileSync(
  join(outDir, "index.html"),
  page({
    title: "Policies | Campus Social",
    body:
      `<h1>Campus Social policies</h1>\n<nav aria-label="Policies"><ul>\n` +
      built.map((d) => `<li><a href="${d.slug}/">${escapeHtml(d.title)}</a>${d.draft ? " (draft)" : ""}</li>`).join("\n") +
      `\n</ul></nav>`,
    draftNote: anyDraft ? "These documents are drafts that have not been reviewed by a lawyer. Do not rely on them." : "",
    footer: "Campus Social",
  }),
);

console.log(`Built ${built.length} pages to ${outDir}`);
for (const d of built) {
  console.log(`  /${d.slug}/  ${d.draft ? "DRAFT" : "final"}  ${d.placeholders} placeholder(s)`);
}
