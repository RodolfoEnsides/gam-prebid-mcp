import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import type { OrderAuditService } from '../../src/audit/order-audit-service.js';
import type { GamWriteService } from '../../src/gam/services/write-service.js';
import type { BatchWriteResult, WriteItemResult } from '../../src/gam/models/write-models.js';
import { PrebidAuditService } from '../../src/prebid/audit-service.js';
import { GamGranularityPlanService } from '../../src/prebid/gam-granularity-plan-service.js';
import { GranularityApplicationService } from '../../src/prebid/granularity-application-service.js';
import { GranularityPlanningService } from '../../src/prebid/granularity-planning-service.js';
import { GranularityPlanStore } from '../../src/prebid/plan-store.js';
import { PriceBucketEngine } from '../../src/prebid/price-bucket-engine.js';
import { SecurityPolicy } from '../../src/security/policy.js';
import { createTestConfig } from '../helpers.js';
import { applicationAuditFixture } from './stage6-fixtures.js';

const directories: string[] = [];
afterEach(async () =>
  Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))),
);

describe('GranularityApplicationService', () => {
  it('enforces PLAN -> DRY RUN -> VALIDATE -> APPLY -> POST AUDIT', async () => {
    const audit = applicationAuditFixture();
    const { service } = await setup(() => audit);
    const created = await service.create(request());

    await expect(service.validate(created.planId)).rejects.toMatchObject({
      code: 'PLAN_INVALID_STATE',
    });
    const dryRun = await service.apply(created.planId, true);
    expect(dryRun).toMatchObject({ state: 'DRY_RUN_COMPLETE', dryRun: true, changed: false });
    const validation = await service.validate(created.planId);
    expect(validation).toMatchObject({ state: 'VALIDATED', valid: true, immutable: true });
    const applied = await service.apply(created.planId, false);
    expect(applied).toMatchObject({ state: 'APPLIED', success: true });
    const postAudit = await service.postAudit(created.planId);
    expect(postAudit).toMatchObject({
      state: 'POST_AUDITED',
      validation: {
        missingBuckets: 0,
        duplicateBuckets: 0,
        targetingErrors: 0,
        matchesPlan: true,
      },
    });
  });

  it('marks a plan stale when a new Line Item appears before dry-run', async () => {
    let audit = applicationAuditFixture();
    const { service, store } = await setup(() => audit);
    const created = await service.create(request());
    const changed = structuredClone(audit);
    changed.lineItems.push({ ...changed.lineItems[0]!, id: '999', displayName: 'External' });
    changed.summary.lineItems += 1;
    audit = changed;

    await expect(service.apply(created.planId, true)).rejects.toMatchObject({ code: 'PLAN_STALE' });
    expect((await store.get(created.planId)).state).toBe('STALE');
  });

  it('stops at a failed batch and resumes without replaying completed actions', async () => {
    const audit = applicationAuditFixture();
    audit.lineItems.splice(1);
    audit.associations.splice(1);
    audit.summary.lineItems = 1;
    audit.summary.associations = 1;
    let actualCalls = 0;
    const write = {
      createLineItems: async (_items: unknown[], options: { dryRun: boolean }) => {
        if (options.dryRun) return batch(success(true));
        actualCalls += 1;
        if (actualCalls === 2) return batch(failure());
        return batch(success(false, actualCalls === 1 ? '901' : '902'));
      },
    } as unknown as GamWriteService;
    const { service, store } = await setup(() => audit, write, { writeBatchSize: 2 });
    const created = await service.create(request(1));
    await service.apply(created.planId, true);
    await service.validate(created.planId);

    const partial = await service.apply(created.planId, false);
    expect(partial).toMatchObject({
      state: 'PARTIALLY_APPLIED',
      success: false,
      resume: { resumable: true, remainingActions: 1 },
    });
    expect((await store.get(created.planId)).execution.completed).toHaveLength(1);

    const resumed = await service.apply(created.planId, false);
    expect(resumed).toMatchObject({ state: 'APPLIED', success: true });
    expect(actualCalls).toBe(3);
    expect((await store.get(created.planId)).execution.completed).toHaveLength(2);
  });
});

async function setup(
  audit: () => ReturnType<typeof applicationAuditFixture>,
  write = {} as GamWriteService,
  overrides: Parameters<typeof createTestConfig>[0] = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'gam-application-'));
  directories.push(directory);
  const config = createTestConfig({
    readOnly: false,
    dryRun: false,
    allowedOrderIds: new Set(['100']),
    planStoreDirectory: directory,
    ...overrides,
  });
  const orderAudit = { execute: async () => audit() } as unknown as OrderAuditService;
  const engine = new PriceBucketEngine(100);
  const planning = new GranularityPlanningService(engine);
  const store = new GranularityPlanStore(directory);
  const service = new GranularityApplicationService(
    config,
    new SecurityPolicy(config.gam),
    orderAudit,
    planning,
    new GamGranularityPlanService(orderAudit, engine),
    new PrebidAuditService(orderAudit, engine),
    write,
    store,
  );
  return { service, store };
}

function request(max = 0.5) {
  return {
    networkCode: '12345678',
    orderId: '100',
    planning: {
      mode: 'custom' as const,
      currency: 'USD',
      standardGranularity: 'medium' as const,
      customGranularity: {
        name: 'custom' as const,
        ranges: [
          {
            min: 0,
            max,
            increment: 0.5,
            precision: 2,
            cap: true,
            rounding: 'FLOOR' as const,
          },
        ],
      },
      minimumHistoricalSamples: 100,
    },
    lineItemTemplate: {
      namePrefix: 'Prebid',
      priority: 12,
      lineItemType: 'PRICE_PRIORITY',
      costType: 'CPM' as const,
      creativePlaceholderSizes: ['1x1'],
      simultaneousAdUnits: 1,
    },
    baseLineItemId: '201',
    creativeStrategy: { mode: 'none' as const },
  };
}

function batch(result: WriteItemResult): BatchWriteResult {
  return {
    operation: result.operation,
    dryRun: result.dryRun,
    changed: result.changed,
    success: result.success,
    summary: {
      total: 1,
      succeeded: result.success ? 1 : 0,
      failed: result.success ? 0 : 1,
      changed: result.changed ? 1 : 0,
    },
    results: [result],
    rollback: {
      requested: false,
      attempted: false,
      succeeded: null,
      resourceIds: [],
      errors: [],
    },
  };
}

function success(dryRun: boolean, resourceId?: string): WriteItemResult {
  return {
    timestamp: new Date().toISOString(),
    operation: 'gam_create_line_item',
    resourceType: 'lineItem',
    ...(resourceId ? { resourceId } : {}),
    dryRun,
    changed: !dryRun,
    success: true,
    idempotent: false,
    warnings: [],
    errors: [],
  };
}

function failure(): WriteItemResult {
  return {
    timestamp: new Date().toISOString(),
    operation: 'gam_create_line_item',
    resourceType: 'lineItem',
    dryRun: false,
    changed: false,
    success: false,
    idempotent: false,
    warnings: [],
    errors: ['GAM_RATE_LIMITED: retry later'],
  };
}
