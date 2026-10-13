import pg from "pg";
import { PgLifecycleStore } from "../account/pgLifecycleStore.js";
import { runLifecycleSweep } from "../account/lifecycleStore.js";
import { loadConfig } from "../config.js";
import { createPhotoStoreOrExit } from "../content/storage.js";
import { LinkCrypto } from "../identity/linkCrypto.js";

const config = loadConfig();
const url = config.LIFECYCLE_DATABASE_URL;
if (!url) {
  console.error("LIFECYCLE_DATABASE_URL is required to run the lifecycle sweep.");
  process.exit(1);
}

const opts = {
  reverifyGraceDays: config.REVERIFY_GRACE_DAYS,
  purgeAfterDays: config.PURGE_AFTER_DAYS,
  codeRetentionHours: config.CODE_RETENTION_HOURS,
  sessionRetentionDays: config.SESSION_RETENTION_DAYS,
  staleUploadHours: config.STALE_UPLOAD_HOURS,
  dismissedReportDays: config.RETENTION_DISMISSED_REPORT_DAYS,
  resolvedRecordDays: config.RETENTION_RESOLVED_RECORD_DAYS,
  appealRecordDays: config.RETENTION_APPEAL_DAYS,
  warningMonths: config.WARNING_EXPIRY_MONTHS,
  auditLogYears: config.AUDIT_LOG_RETENTION_YEARS,
};

if (process.argv.includes("--dry")) {
  console.log("dry run: no changes made. Settings:", opts);
  process.exit(0);
}

const linkCrypto =
  config.LINK_ENCRYPTION_KEYS && config.LINK_BLIND_INDEX_KEY
    ? new LinkCrypto(config.LINK_ENCRYPTION_KEYS, config.LINK_BLIND_INDEX_KEY)
    : undefined;

const photoStore = createPhotoStoreOrExit(config);

const pool = new pg.Pool({ connectionString: url, max: 2 });
try {
  const result = await runLifecycleSweep(new PgLifecycleStore(pool, {
      decryptAnonymousProfileId: linkCrypto
        ? (enc, accountId) => linkCrypto.decrypt(enc, accountId)
        : undefined,
    }),
    opts,
    new Date(),
    photoStore,
  );
  console.log("lifecycle sweep complete:", result);
  if (result.filesFailed > 0) {
    console.warn(
      `${result.filesFailed} photo file(s) could not be deleted; they stay queued and will be retried.`,
    );
  }
  if (result.skipped > 0) {
    console.warn(
      `${result.skipped} account(s) skipped: they have an anonymous profile and no resolver is configured.`,
    );
  }
} finally {
  await pool.end();
}
