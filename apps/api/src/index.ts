import pg from "pg";
import { AccountService } from "./account/service.js";
import { AuthActorResolver } from "./content/actor.js";
import { LocalPhotoStore } from "./content/photos.js";
import { PgContentStore } from "./content/pgStore.js";
import { ContentService, DEFAULT_CONTENT_OPTIONS } from "./content/service.js";
import { buildSupportInfo } from "./moderation/crisis.js";
import { PgReportStore, ReportService } from "./moderation/reports.js";
import { LinkCrypto } from "./identity/linkCrypto.js";
import { ProfileService } from "./profile/service.js";
import { DEFAULT_IDENTITY_OPTIONS, IdentityService } from "./identity/service.js";
import { z } from "zod";
import { PgLifecycleStore } from "./account/pgLifecycleStore.js";
import { buildApp } from "./app.js";
import { PgAuthStore } from "./auth/pgStore.js";
import { ConsoleMailer, SmtpMailer } from "./auth/mailer.js";
import { AuthService } from "./auth/service.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

if (config.SMTP_URL && !config.MAIL_FROM) {
  throw new Error("MAIL_FROM is required when SMTP_URL is set");
}
const mailer =
  config.SMTP_URL && config.MAIL_FROM
    ? SmtpMailer.fromUrl(config.SMTP_URL, config.MAIL_FROM, {
        requireTls: config.NODE_ENV === "production",
      })
    : new ConsoleMailer(undefined, config.NODE_ENV);

const authStore = new PgAuthStore(new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 }));
const auth = new AuthService(authStore, mailer, {
  codeHmacKey: config.CODE_HMAC_KEY,
  codeTtlMinutes: config.EMAIL_CODE_TTL_MINUTES,
  maxCodesPerHour: config.MAX_CODES_PER_HOUR,
  maxCodeAttempts: config.MAX_CODE_ATTEMPTS,
  sessionTtlDays: config.SESSION_TTL_DAYS,
  termsVersion: config.TERMS_VERSION,
});

const linkCrypto =
  config.LINK_ENCRYPTION_KEYS && config.LINK_BLIND_INDEX_KEY
    ? new LinkCrypto(config.LINK_ENCRYPTION_KEYS, config.LINK_BLIND_INDEX_KEY)
    : undefined;

const identity = linkCrypto
  ? new IdentityService(auth, authStore, linkCrypto, {
      ...DEFAULT_IDENTITY_OPTIONS,
      minAccountAgeDays: config.ANON_MIN_ACCOUNT_AGE_DAYS,
    })
  : undefined;

const account = config.LIFECYCLE_DATABASE_URL
  ? new AccountService(
      auth,
      authStore,
      new PgLifecycleStore(new pg.Pool({ connectionString: config.LIFECYCLE_DATABASE_URL, max: 5 }), {
        decryptAnonymousProfileId: linkCrypto
          ? (enc, accountId) => linkCrypto.decrypt(enc, accountId)
          : undefined,
      }),
    )
  : undefined;

const supportResources = z
  .array(z.object({ name: z.string().min(1), contact: z.string().min(1) }))
  .parse(JSON.parse(config.SUPPORT_RESOURCES_JSON));

let reportLog: (err: unknown) => void = () => undefined;

const content = config.CONTENT_DATABASE_URL
  ? (() => {
      const contentPool = new pg.Pool({ connectionString: config.CONTENT_DATABASE_URL, max: 10 });
      const reportStore = new PgReportStore(contentPool);
      return {
        service: new ContentService(
          new PgContentStore(contentPool),
          new LocalPhotoStore(config.PHOTO_DIR),
          DEFAULT_CONTENT_OPTIONS,
          () => new Date(),
          {
            flagForReview: (kind, id) => reportStore.fileAutoFlag(kind, id),
            support: buildSupportInfo(supportResources),
            onError: (err) => reportLog(err),
          },
        ),
        actors: new AuthActorResolver(
          auth,
          linkCrypto ? { store: authStore, crypto: linkCrypto } : undefined,
        ),
        reports: new ReportService(reportStore),
      };
    })()
  : undefined;

const app = buildApp({ auth, account, content, identity, profile: new ProfileService(auth, authStore) });
if (config.DEV_CORS_ORIGIN) {
  if (config.NODE_ENV === "production") {
    throw new Error("DEV_CORS_ORIGIN must not be set in production");
  }
  const origin = config.DEV_CORS_ORIGIN;
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Vary", "Origin");
    reply.header("Access-Control-Allow-Headers", "authorization, content-type, x-acting-as");
    reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return reply.code(204).send();
  });
  app.log.warn({ origin }, "DEV_CORS_ORIGIN set: development only");
}
reportLog = (err) => app.log.error({ err }, "failed to flag a post for review");
if (!account) {
  app.log.warn("LIFECYCLE_DATABASE_URL not set: /account/* routes are disabled");
}
if (!linkCrypto) {
  app.log.warn("LINK_ENCRYPTION_KEYS / LINK_BLIND_INDEX_KEY not set: anonymous profiles are disabled");
}
if (!content) {
  app.log.warn("CONTENT_DATABASE_URL not set: posting, feed and follow routes are disabled");
}

app.listen({ port: config.PORT, host: "127.0.0.1" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
