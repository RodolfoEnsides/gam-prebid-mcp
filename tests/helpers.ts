import type { AppConfig } from '../src/config/env.js';
import type { Logger } from '../src/logging/logger.js';

export function createTestConfig(overrides: Partial<AppConfig['gam']> = {}): AppConfig {
  return {
    gam: {
      networkCode: '12345678',
      readOnly: true,
      dryRun: true,
      allowedOrderIds: new Set(),
      allowedNetworkCodes: new Set(['12345678']),
      requestTimeoutMs: 50,
      maxRetries: 0,
      pageSize: 50,
      defaultListLimit: 200,
      maxListLimit: 2_000,
      auditMaxResources: 10_000,
      auditConcurrency: 5,
      soapApiVersion: 'v202608',
      applicationName: 'gam-prebid-mcp-test',
      maxBulkCreate: 50,
      maxBulkUpdate: 50,
      writeBatchSize: 20,
      planStoreDirectory: '/tmp/gam-prebid-mcp-test-plans',
      planMaxAgeMs: 86_400_000,
      ...overrides,
    },
    google: {},
    logging: { level: 'error' },
    prebid: {
      allowedConfigDirectories: [],
      maxConfigBytes: 1_048_576,
      maxBuckets: 100_000,
    },
  };
}

export const noopLogger: Logger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
};
