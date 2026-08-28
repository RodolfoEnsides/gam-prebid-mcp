import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadConfig } from '../../src/config/env.js';

describe('loadConfig', () => {
  it('loads safe defaults and uses the configured network as the default allowlist', () => {
    const config = loadConfig({ GAM_NETWORK_CODE: '12345678' });

    expect(config.gam.readOnly).toBe(true);
    expect(config.gam.dryRun).toBe(true);
    expect([...config.gam.allowedNetworkCodes]).toEqual(['12345678']);
    expect(config.gam.allowedOrderIds.size).toBe(0);
    expect(config.gam.defaultListLimit).toBe(200);
    expect(config.gam.auditConcurrency).toBe(5);
    expect(config.gam.soapApiVersion).toBe('v202608');
    expect(config.prebid.maxBuckets).toBe(100_000);
    expect(config.prebid.allowedConfigDirectories).toEqual([]);
    expect(config.gam.maxBulkCreate).toBe(50);
    expect(config.gam.maxBulkUpdate).toBe(50);
    expect(config.gam.writeBatchSize).toBe(20);
    expect(config.gam.planStoreDirectory).toMatch(/\.gam-prebid-plans$/);
    expect(config.gam.planMaxAgeMs).toBe(86_400_000);
  });

  it('parses explicit allowlists without duplicates', () => {
    const config = loadConfig({
      GAM_NETWORK_CODE: '12345678',
      GAM_ALLOWED_NETWORK_CODES: '87654321, 12345678,87654321',
      GAM_ALLOWED_ORDER_IDS: '42, 7',
      GAM_READ_ONLY: 'false',
      GAM_DRY_RUN: 'false',
      PREBID_CONFIG_ALLOWED_DIRS: '/safe/a,/safe/b',
      GAM_MAX_BULK_CREATE: '10',
      GAM_MAX_BULK_UPDATE: '20',
      GAM_WRITE_BATCH_SIZE: '7',
      GAM_PLAN_STORE_DIR: '/tmp/gam-plans',
      GAM_PLAN_MAX_AGE_MS: '3600000',
    });

    expect([...config.gam.allowedNetworkCodes]).toEqual(['12345678', '87654321']);
    expect([...config.gam.allowedOrderIds]).toEqual(['42', '7']);
    expect(config.gam.readOnly).toBe(false);
    expect(config.gam.dryRun).toBe(false);
    expect(config.prebid.allowedConfigDirectories).toEqual(['/safe/a', '/safe/b']);
    expect(config.gam.maxBulkCreate).toBe(10);
    expect(config.gam.maxBulkUpdate).toBe(20);
    expect(config.gam.writeBatchSize).toBe(7);
    expect(config.gam.planStoreDirectory).toBe('/tmp/gam-plans');
    expect(config.gam.planMaxAgeMs).toBe(3_600_000);
  });

  it('rejects missing or malformed required configuration', () => {
    expect(() => loadConfig({ GAM_NETWORK_CODE: 'not-a-network' })).toThrow(ConfigurationError);
    expect(() => loadConfig({})).toThrow(/GAM_NETWORK_CODE/);
  });
});
