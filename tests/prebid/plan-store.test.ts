import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { sealedPlanPayload } from '../../src/prebid/application-plan-builder.js';
import type { StoredGranularityPlan } from '../../src/prebid/application-models.js';
import { canonicalHash } from '../../src/prebid/material-snapshot.js';
import { GranularityPlanStore } from '../../src/prebid/plan-store.js';

const directories: string[] = [];
afterEach(async () =>
  Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))),
);

describe('GranularityPlanStore', () => {
  it('persists revisions atomically and rejects validated plan mutation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gam-plan-store-'));
    directories.push(directory);
    const store = new GranularityPlanStore(directory);
    let plan = fixturePlan();
    await store.create(plan);
    plan = await store.update(plan.planId, 1, (current) => ({
      ...current,
      state: 'DRY_RUN_COMPLETE',
    }));
    const seal = canonicalHash(sealedPlanPayload(plan));
    plan = await store.update(plan.planId, 2, (current) => ({
      ...current,
      state: 'VALIDATED',
      sealedPlanHash: seal,
    }));

    await expect(
      store.update(plan.planId, 3, (current) => ({ ...current, warnings: ['tampered'] })),
    ).rejects.toMatchObject({ code: 'PLAN_TAMPERED' });
    expect((await store.get(plan.planId)).revision).toBe(3);
  });

  it('rejects path traversal plan ids', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gam-plan-store-'));
    directories.push(directory);
    const store = new GranularityPlanStore(directory);
    await expect(store.get('../credentials')).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
  });
});

function fixturePlan(): StoredGranularityPlan {
  const capturedAt = new Date().toISOString();
  const snapshot = {
    hash: 'abc',
    capturedAt,
    order: { id: '100', hash: 'a', value: {} },
    lineItems: [],
    creatives: [],
    associations: [],
    customTargeting: [],
  };
  return {
    schemaVersion: 1,
    revision: 1,
    planId: 'prebid-apply:0123456789abcdef',
    planHash: 'sha256:test',
    state: 'PLANNED',
    networkCode: '12345678',
    orderId: '100',
    granularity: 'custom',
    createdAt: capturedAt,
    updatedAt: capturedAt,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    sourcePlan: {} as StoredGranularityPlan['sourcePlan'],
    planningRequest: {} as StoredGranularityPlan['planningRequest'],
    creativeStrategy: { mode: 'none' },
    lineItemTemplate: {
      namePrefix: 'Prebid',
      priority: 12,
      lineItemType: 'PRICE_PRIORITY',
      costType: 'CPM',
      creativePlaceholderSizes: ['1x1'],
      simultaneousAdUnits: 1,
    },
    snapshot,
    checkpointSnapshot: snapshot,
    create: [],
    update: [],
    associate: [],
    unchanged: [],
    warnings: [],
    errors: [],
    execution: { completed: [], resourceRefs: {}, batchesCompleted: 0 },
  };
}
