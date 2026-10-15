import { z } from "zod";

const dayList = (max: number) =>
  z
    .string()
    .transform((v, ctx) => {
      const parts = v.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
      const nums = parts.map(Number);
      if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > max) || nums.length > 5) {
        ctx.addIssue({ code: "custom", message: `use up to 5 whole numbers from 1 to ${max}, separated by commas` });
        return z.NEVER;
      }
      return [...new Set(nums)].sort((a, b) => b - a);
    });

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().min(1).default("127.0.0.1"),
  DEV_CORS_ORIGIN: z.string().url().optional(),
  DATABASE_URL: z.string().min(1).optional(),
  NODE_ENV: z.string().default("development"),
  SMTP_URL: z.string().url().optional(),
  MAIL_FROM: z.string().min(3).optional(),
  CODE_HMAC_KEY: z.string().min(32).optional(),
  EMAIL_CODE_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  MAX_CODES_PER_HOUR: z.coerce.number().int().positive().default(5),
  MAX_CODE_ATTEMPTS: z.coerce.number().int().positive().default(5),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // Bump when the terms change; stored with each acceptance.
  TERMS_VERSION: z.string().default("draft-0"),
  LIFECYCLE_DATABASE_URL: z.string().min(1).optional(),
  CONTENT_DATABASE_URL: z.string().min(1).optional(),
  PHOTO_DIR: z.string().default("./data/photos"),
  PHOTO_STORAGE: z.enum(["local", "s3"]).default("local"),
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_KEY_PREFIX: z
    .string()
    .regex(/^([A-Za-z0-9_.-]+\/)*$/, "must be empty or end with a slash")
    .optional(),
  LINK_ENCRYPTION_KEYS: z.string().min(1).optional(),
  LINK_BLIND_INDEX_KEY: z.string().min(1).optional(),
  ANON_MIN_ACCOUNT_AGE_DAYS: z.coerce.number().int().min(0).default(3),
  ADMIN_DATABASE_URL: z.string().min(1).optional(),
  ADMIN_PORT: z.coerce.number().default(3100),
  SUPPORT_RESOURCES_JSON: z.string().default("[]"),
  REVERIFY_GRACE_DAYS: z.coerce.number().int().positive().default(30),
  CODE_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
  SESSION_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  STALE_UPLOAD_HOURS: z.coerce.number().int().positive().default(24),
  RETENTION_DISMISSED_REPORT_DAYS: z.coerce.number().int().min(30).default(90),
  RETENTION_RESOLVED_RECORD_DAYS: z.coerce.number().int().min(180).default(365),
  RETENTION_APPEAL_DAYS: z.coerce.number().int().min(180).default(365),
  WARNING_EXPIRY_MONTHS: z.coerce.number().int().min(3).default(12),
  AUDIT_LOG_RETENTION_YEARS: z.coerce.number().int().min(1).default(3),
  // Spec: deleted content is purged within 30 days.
  PURGE_AFTER_DAYS: z.coerce.number().int().positive().default(30),
  REVERIFY_REMINDER_DAYS: dayList(365).default("30,7"),
  CLOSURE_REMINDER_DAYS: dayList(60).default("7"),
  REMINDER_MAX_PER_RUN: z.coerce.number().int().min(1).max(5000).default(500),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
