import assert from "node:assert/strict";
import { test } from "node:test";
import { checkMailDns, classifyMx, domainOf } from "./check-mail-dns.mjs";

function resolver({ txt = {}, mx = {}, cname = {} } = {}) {
  const miss = () => Object.assign(new Error("none"), { code: "ENODATA" });
  return {
    resolveTxt: async (n) => {
      if (!(n in txt)) throw miss();
      return txt[n].map((t) => [t]);
    },
    resolveMx: async (n) => {
      if (!(n in mx)) throw miss();
      return mx[n];
    },
    resolveCname: async (n) => {
      if (!(n in cname)) throw miss();
      return cname[n];
    },
  };
}

const GOOD = {
  txt: {
    "mail.example.org": ["v=spf1 include:_spf.provider.test -all"],
    "_dmarc.mail.example.org": ["v=DMARC1; p=quarantine; rua=mailto:dmarc@example.org"],
    "s1._domainkey.mail.example.org": ["v=DKIM1; k=rsa; p=MIGfMA0GCSq"],
  },
  mx: { "mail.example.org": [{ exchange: "mx.provider.test", priority: 10 }] },
};

test("domainOf reads the address from a display-name sender", () => {
  assert.equal(domainOf("Moku <no-reply@Mail.Example.org>"), "mail.example.org");
  assert.equal(domainOf("no-reply@mail.example.org"), "mail.example.org");
  assert.equal(domainOf("nonsense"), null);
});

test("a fully configured domain passes with no problems", async () => {
  const r = await checkMailDns({ domain: "mail.example.org", selectors: ["s1"], resolver: resolver(GOOD) });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.warnings, []);
});

test("a domain with no records fails on SPF, DMARC and DKIM", async () => {
  const r = await checkMailDns({ domain: "bare.example.org", selectors: ["s1"], resolver: resolver() });
  const text = r.problems.join("\n");
  assert.match(text, /no SPF record/);
  assert.match(text, /no DMARC record/);
  assert.match(text, /No DKIM key/);
});

test("two SPF records, or a pass-all rule, are refused", async () => {
  const two = resolver({
    txt: { ...GOOD.txt, "mail.example.org": ["v=spf1 -all", "v=spf1 ~all"] },
    mx: GOOD.mx,
  });
  assert.match((await checkMailDns({ domain: "mail.example.org", resolver: two })).problems.join(), /2 SPF records/);
  const open = resolver({ txt: { ...GOOD.txt, "mail.example.org": ["v=spf1 +all"] }, mx: GOOD.mx });
  assert.match((await checkMailDns({ domain: "mail.example.org", resolver: open })).problems.join(), /pass-all/);
});

test("DMARC p=none is a warning, an invalid policy is a problem", async () => {
  const none = resolver({
    txt: { ...GOOD.txt, "_dmarc.mail.example.org": ["v=DMARC1; p=none; rua=mailto:a@example.org"] },
    mx: GOOD.mx,
  });
  const r = await checkMailDns({ domain: "mail.example.org", selectors: ["s1"], resolver: none });
  assert.deepEqual(r.problems, []);
  assert.match(r.warnings.join(), /p=none/);

  const bad = resolver({ txt: { ...GOOD.txt, "_dmarc.mail.example.org": ["v=DMARC1; rua=mailto:a@example.org"] }, mx: GOOD.mx });
  assert.match((await checkMailDns({ domain: "mail.example.org", resolver: bad })).problems.join(), /valid p= policy/);
});

test("a revoked DKIM key is a problem and a CNAME selector is accepted", async () => {
  const revoked = resolver({
    txt: { ...GOOD.txt, "s1._domainkey.mail.example.org": ["v=DKIM1; k=rsa; p="] },
    mx: GOOD.mx,
  });
  assert.match(
    (await checkMailDns({ domain: "mail.example.org", selectors: ["s1"], resolver: revoked })).problems.join(),
    /revoked/,
  );
  const viaCname = resolver({
    txt: { "mail.example.org": GOOD.txt["mail.example.org"], "_dmarc.mail.example.org": GOOD.txt["_dmarc.mail.example.org"] },
    mx: GOOD.mx,
    cname: { "s2._domainkey.mail.example.org": ["s2.dkim.provider.test"] },
  });
  const r = await checkMailDns({ domain: "mail.example.org", selectors: ["s2"], resolver: viaCname });
  assert.deepEqual(r.problems, []);
});

test("not passing a selector is a warning, not a pass", async () => {
  const r = await checkMailDns({ domain: "mail.example.org", resolver: resolver(GOOD) });
  assert.match(r.warnings.join(), /DKIM was not checked/);
});

test("it identifies a recipient domain that uses Microsoft 365 first, with Google as fallback", async () => {
  const usiuLike = resolver({
    ...GOOD,
    mx: {
      ...GOOD.mx,
      "usiu.example": [
        { exchange: "ASPMX.L.GOOGLE.COM", priority: 5 },
        { exchange: "usiu-example.mail.protection.outlook.COM", priority: 1 },
        { exchange: "ALT1.ASPMX.L.GOOGLE.COM", priority: 10 },
      ],
    },
  });
  const r = await checkMailDns({
    domain: "mail.example.org",
    selectors: ["s1"],
    recipientDomain: "usiu.example",
    resolver: usiuLike,
  });
  assert.match(r.info.join("\n"), /Microsoft 365 \(usiu-example\.mail\.protection\.outlook\.COM, preference 1\)/);
  assert.match(r.info.join("\n"), /filters unknown senders strictly/);
  assert.equal(classifyMx([{ exchange: "x.googlemail.com", priority: 1 }])[0].kind, "Google Workspace");
});

test("a recipient domain with no MX is flagged", async () => {
  const r = await checkMailDns({
    domain: "mail.example.org",
    selectors: ["s1"],
    recipientDomain: "nowhere.example",
    resolver: resolver(GOOD),
  });
  assert.match(r.warnings.join(), /no MX records/);
});
