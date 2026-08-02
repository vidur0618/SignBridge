import { resolve } from "node:path";
import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    APP_ORIGIN: z.string().url().default("http://127.0.0.1:4173"),
    SESSION_SECRET: z
      .string()
      .min(32)
      .default("local-only-session-secret-change-before-production"),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(28_800),
    PILOT_SITE_ID: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/).default("demo-reception"),
    PILOT_SITE_CODE: z.string().min(8).default("signbridge-demo"),
    ADMIN_ACCESS_CODE: z.string().min(12).default("signbridge-admin-demo"),
    USE_GOOGLE_CLOUD: booleanFromString,
    GOOGLE_CLOUD_PROJECT: z.string().optional(),
    GOOGLE_CLOUD_LOCATION: z.string().default("global"),
    GOOGLE_SPEECH_LOCATION: z.string().default("global"),
    GOOGLE_SPEECH_RECOGNIZER: z.string().default("_"),
    GOOGLE_SPEECH_MODEL: z.string().default("chirp_3"),
    GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
    SIGN_ASSET_BUCKET: z.string().optional(),
    FIRESTORE_DATABASE: z.string().default("(default)"),
    SIGN_CATALOG_PATH: z.string().optional(),
    SIGN_REVOCATION_PATH: z.string().optional(),
    WEB_DIST_DIR: z.string().optional(),
    MAX_LIVE_SESSIONS_PER_SITE: z.coerce.number().int().min(1).max(10).default(2),
    OPS_JOB_SECRET: z.string().min(24).optional(),
    INTERNAL_OIDC_AUDIENCE: z.string().url().optional(),
    INTERNAL_OIDC_SERVICE_ACCOUNT: z.string().email().optional(),
    SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(300),
    EVENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    DEPLOYMENT_SHA: z.string().regex(/^[a-f0-9]{7,64}$/i).optional(),
    K_SERVICE: z.string().min(1).max(128).optional(),
    K_REVISION: z.string().min(1).max(128).optional(),
  })
  .superRefine((env, context) => {
    if (
      env.NODE_ENV === "production" &&
      (env.SESSION_SECRET === "local-only-session-secret-change-before-production" ||
        env.PILOT_SITE_CODE === "signbridge-demo" ||
        env.ADMIN_ACCESS_CODE === "signbridge-admin-demo")
    ) {
      context.addIssue({
        code: "custom",
        message: "Production requires non-default session and access-code secrets",
      });
    }
    if (!env.USE_GOOGLE_CLOUD) return;
    const required = [
      ["GOOGLE_CLOUD_PROJECT", env.GOOGLE_CLOUD_PROJECT],
      ["SIGN_ASSET_BUCKET", env.SIGN_ASSET_BUCKET],
    ] as const;
    for (const [name, value] of required) {
      if (!value) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: `${name} is required when USE_GOOGLE_CLOUD=true`,
        });
      }
    }
  });

export type AppConfig = Readonly<{
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  appOrigin: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
  pilotSiteId: string;
  pilotSiteCode: string;
  adminAccessCode: string;
  useGoogleCloud: boolean;
  googleCloudProject?: string;
  googleCloudLocation: string;
  googleSpeechLocation: string;
  googleSpeechRecognizer: string;
  googleSpeechModel: string;
  geminiModel: string;
  signAssetBucket?: string;
  firestoreDatabase: string;
  signCatalogPath?: string;
  signRevocationPath?: string;
  webDistDir?: string;
  maxLiveSessionsPerSite: number;
  opsJobSecret?: string;
  internalOidcAudience?: string;
  internalOidcServiceAccount?: string;
  signedUrlTtlSeconds: number;
  eventRetentionDays: number;
  deploymentSha?: string;
  serviceName?: string;
  serviceRevision?: string;
}>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(environment);
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    appOrigin: parsed.APP_ORIGIN.replace(/\/$/, ""),
    sessionSecret: parsed.SESSION_SECRET,
    sessionTtlSeconds: parsed.SESSION_TTL_SECONDS,
    pilotSiteId: parsed.PILOT_SITE_ID,
    pilotSiteCode: parsed.PILOT_SITE_CODE,
    adminAccessCode: parsed.ADMIN_ACCESS_CODE,
    useGoogleCloud: parsed.USE_GOOGLE_CLOUD,
    ...(parsed.GOOGLE_CLOUD_PROJECT ? { googleCloudProject: parsed.GOOGLE_CLOUD_PROJECT } : {}),
    googleCloudLocation: parsed.GOOGLE_CLOUD_LOCATION,
    googleSpeechLocation: parsed.GOOGLE_SPEECH_LOCATION,
    googleSpeechRecognizer: parsed.GOOGLE_SPEECH_RECOGNIZER,
    googleSpeechModel: parsed.GOOGLE_SPEECH_MODEL,
    geminiModel: parsed.GEMINI_MODEL,
    ...(parsed.SIGN_ASSET_BUCKET ? { signAssetBucket: parsed.SIGN_ASSET_BUCKET } : {}),
    firestoreDatabase: parsed.FIRESTORE_DATABASE,
    ...(parsed.SIGN_CATALOG_PATH ? { signCatalogPath: resolve(parsed.SIGN_CATALOG_PATH) } : {}),
    ...(parsed.SIGN_REVOCATION_PATH
      ? { signRevocationPath: resolve(parsed.SIGN_REVOCATION_PATH) }
      : {}),
    ...(parsed.WEB_DIST_DIR ? { webDistDir: resolve(parsed.WEB_DIST_DIR) } : {}),
    maxLiveSessionsPerSite: parsed.MAX_LIVE_SESSIONS_PER_SITE,
    ...(parsed.OPS_JOB_SECRET ? { opsJobSecret: parsed.OPS_JOB_SECRET } : {}),
    ...(parsed.INTERNAL_OIDC_AUDIENCE
      ? { internalOidcAudience: parsed.INTERNAL_OIDC_AUDIENCE }
      : {}),
    ...(parsed.INTERNAL_OIDC_SERVICE_ACCOUNT
      ? { internalOidcServiceAccount: parsed.INTERNAL_OIDC_SERVICE_ACCOUNT }
      : {}),
    signedUrlTtlSeconds: parsed.SIGNED_URL_TTL_SECONDS,
    eventRetentionDays: parsed.EVENT_RETENTION_DAYS,
    ...(parsed.DEPLOYMENT_SHA ? { deploymentSha: parsed.DEPLOYMENT_SHA } : {}),
    ...(parsed.K_SERVICE ? { serviceName: parsed.K_SERVICE } : {}),
    ...(parsed.K_REVISION ? { serviceRevision: parsed.K_REVISION } : {}),
  };
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    appOrigin: "http://127.0.0.1:4173",
    sessionSecret: "test-session-secret-that-is-at-least-32-chars",
    sessionTtlSeconds: 3_600,
    pilotSiteId: "test-site",
    pilotSiteCode: "site-code-test",
    adminAccessCode: "admin-code-test-value",
    useGoogleCloud: false,
    googleCloudLocation: "global",
    googleSpeechLocation: "global",
    googleSpeechRecognizer: "_",
    googleSpeechModel: "chirp_3",
    geminiModel: "gemini-3.6-flash",
    firestoreDatabase: "(default)",
    maxLiveSessionsPerSite: 2,
    signedUrlTtlSeconds: 300,
    eventRetentionDays: 30,
    ...overrides,
  };
}
