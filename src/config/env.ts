import { z } from 'zod/v4';
import { resolve } from 'node:path';

const booleanFromEnv = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .default(String(defaultValue) as 'true' | 'false')
    .transform((value) => value === 'true');

const csvIds = z
  .string()
  .default('')
  .transform((value) =>
    [
      ...new Set(
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ].sort(),
  )
  .pipe(z.array(z.string().regex(/^\d+$/)));

const csvStrings = z
  .string()
  .default('')
  .transform((value) => [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]);

const envSchema = z.object({
  GAM_NETWORK_CODE: z.string().trim().regex(/^\d+$/, 'must contain only digits'),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().trim().min(1).optional(),
  GAM_READ_ONLY: booleanFromEnv(true),
  GAM_DRY_RUN: booleanFromEnv(true),
  GAM_ALLOWED_ORDER_IDS: csvIds,
  GAM_ALLOWED_NETWORK_CODES: csvIds,
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  GAM_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
  GAM_MAX_RETRIES: z.coerce.number().int().min(0).max(8).default(3),
  GAM_PAGE_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  GAM_DEFAULT_LIST_LIMIT: z.coerce.number().int().min(1).max(10_000).default(200),
  GAM_MAX_LIST_LIMIT: z.coerce.number().int().min(1).max(50_000).default(2_000),
  GAM_AUDIT_MAX_RESOURCES: z.coerce.number().int().min(1).max(100_000).default(10_000),
  GAM_AUDIT_CONCURRENCY: z.coerce.number().int().min(1).max(25).default(5),
  GAM_SOAP_API_VERSION: z
    .string()
    .regex(/^v\d{6}$/)
    .default('v202608'),
  GAM_APPLICATION_NAME: z.string().trim().min(1).max(128).default('gam-prebid-mcp'),
  GAM_MAX_BULK_CREATE: z.coerce.number().int().min(1).max(500).default(50),
  GAM_MAX_BULK_UPDATE: z.coerce.number().int().min(1).max(500).default(50),
  GAM_WRITE_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(20),
  GAM_PLAN_STORE_DIR: z.string().trim().min(1).default('.gam-prebid-plans'),
  GAM_PLAN_MAX_AGE_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(30 * 24 * 60 * 60 * 1_000)
    .default(86_400_000),
  PREBID_CONFIG_ALLOWED_DIRS: csvStrings,
  PREBID_MAX_CONFIG_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(10 * 1_024 * 1_024)
    .default(1_048_576),
  PREBID_MAX_BUCKETS: z.coerce.number().int().min(1).max(1_000_000).default(100_000),
});

export type AppConfig = {
  gam: {
    networkCode: string;
    readOnly: boolean;
    dryRun: boolean;
    allowedOrderIds: ReadonlySet<string>;
    allowedNetworkCodes: ReadonlySet<string>;
    requestTimeoutMs: number;
    maxRetries: number;
    pageSize: number;
    defaultListLimit: number;
    maxListLimit: number;
    auditMaxResources: number;
    auditConcurrency: number;
    soapApiVersion: string;
    applicationName: string;
    maxBulkCreate: number;
    maxBulkUpdate: number;
    writeBatchSize: number;
    planStoreDirectory: string;
    planMaxAgeMs: number;
  };
  google: { applicationCredentials?: string };
  logging: { level: z.infer<typeof envSchema>['LOG_LEVEL'] };
  prebid: {
    allowedConfigDirectories: readonly string[];
    maxConfigBytes: number;
    maxBuckets: number;
  };
};

export class ConfigurationError extends Error {
  readonly issues: string[];

  constructor(error: z.ZodError) {
    const issues = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    super(`Invalid configuration: ${issues.join('; ')}`);
    this.name = 'ConfigurationError';
    this.issues = issues;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) throw new ConfigurationError(result.error);

  const parsed = result.data;
  const allowedNetworks =
    parsed.GAM_ALLOWED_NETWORK_CODES.length > 0
      ? parsed.GAM_ALLOWED_NETWORK_CODES
      : [parsed.GAM_NETWORK_CODE];

  return {
    gam: {
      networkCode: parsed.GAM_NETWORK_CODE,
      readOnly: parsed.GAM_READ_ONLY,
      dryRun: parsed.GAM_DRY_RUN,
      allowedOrderIds: new Set(parsed.GAM_ALLOWED_ORDER_IDS),
      allowedNetworkCodes: new Set(allowedNetworks),
      requestTimeoutMs: parsed.GAM_REQUEST_TIMEOUT_MS,
      maxRetries: parsed.GAM_MAX_RETRIES,
      pageSize: parsed.GAM_PAGE_SIZE,
      defaultListLimit: parsed.GAM_DEFAULT_LIST_LIMIT,
      maxListLimit: parsed.GAM_MAX_LIST_LIMIT,
      auditMaxResources: parsed.GAM_AUDIT_MAX_RESOURCES,
      auditConcurrency: parsed.GAM_AUDIT_CONCURRENCY,
      soapApiVersion: parsed.GAM_SOAP_API_VERSION,
      applicationName: parsed.GAM_APPLICATION_NAME,
      maxBulkCreate: parsed.GAM_MAX_BULK_CREATE,
      maxBulkUpdate: parsed.GAM_MAX_BULK_UPDATE,
      writeBatchSize: parsed.GAM_WRITE_BATCH_SIZE,
      planStoreDirectory: resolve(parsed.GAM_PLAN_STORE_DIR),
      planMaxAgeMs: parsed.GAM_PLAN_MAX_AGE_MS,
    },
    google: {
      ...(parsed.GOOGLE_APPLICATION_CREDENTIALS
        ? { applicationCredentials: parsed.GOOGLE_APPLICATION_CREDENTIALS }
        : {}),
    },
    logging: { level: parsed.LOG_LEVEL },
    prebid: {
      allowedConfigDirectories: parsed.PREBID_CONFIG_ALLOWED_DIRS,
      maxConfigBytes: parsed.PREBID_MAX_CONFIG_BYTES,
      maxBuckets: parsed.PREBID_MAX_BUCKETS,
    },
  };
}
