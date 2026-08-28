import { describe, expect, it } from 'vitest';

import type { OrderAuditResult } from '../../src/audit/models.js';
import type { OrderAuditService } from '../../src/audit/order-audit-service.js';
import type { LineItem } from '../../src/gam/models/resources.js';
import { GamGranularityPlanService } from '../../src/prebid/gam-granularity-plan-service.js';
import { GranularityPlanningService } from '../../src/prebid/granularity-planning-service.js';
import { PriceBucketEngine } from '../../src/prebid/price-bucket-engine.js';
import { normalCreative, normalOrder } from '../fixtures/gam.js';

describe('GamGranularityPlanService', () => {
  const engine = new PriceBucketEngine(100_000);
  const planning = new GranularityPlanningService(engine);

  it('plans creates, safe alterations, creatives, associations, preservation, and conflicts', async () => {
    const audit = gamPlanFixture();
    const orderAudit = { execute: async () => audit } as unknown as OrderAuditService;
    const service = new GamGranularityPlanService(orderAudit, engine);
    const sourcePlan = planning.plan({
      mode: 'custom',
      currency: 'USD',
      standardGranularity: 'medium',
      customGranularity: {
        name: 'custom',
        ranges: [{ min: 0, max: 1, increment: 0.5, precision: 2, cap: true, rounding: 'FLOOR' }],
      },
      minimumHistoricalSamples: 100,
    });
    const template = {
      namePrefix: 'Prebid USD',
      priority: 12,
      lineItemType: 'PRICE_PRIORITY',
      costType: 'CPM' as const,
      creativePlaceholderSizes: ['1x1'],
      simultaneousAdUnits: 2,
    };

    const result = await service.plan(undefined, '100', sourcePlan, template);
    const repeated = await service.plan(undefined, '100', sourcePlan, template);

    expect(result.status).toBe('READY');
    expect(result.summary).toMatchObject({
      lineItemsToCreate: 1,
      lineItemsToAlter: 1,
      lineItemsPreserved: 3,
      creativesNeeded: 5,
      associationsNeeded: 5,
      conflicts: 1,
    });
    expect(result.lineItemsToCreate[0]).toMatchObject({
      hbPb: '1.00',
      cpm: { currencyCode: 'USD', micros: '1000000', value: '1.00' },
      priority: 12,
      lineItemType: 'PRICE_PRIORITY',
      creativePlaceholderSizes: ['1x1'],
      creativesNeeded: 2,
    });
    expect(result.lineItemsToAlter[0]?.reasons).toContain('CPM differs.');
    expect(result.conflicts[0]?.code).toBe('EXTRA_HB_PB_BUCKET_PRESERVED');
    expect(result.changed).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.planHash).toBe(repeated.planHash);
  });

  it('blocks GAM planning when recommend cannot select a granularity', async () => {
    const audit = gamPlanFixture();
    const orderAudit = { execute: async () => audit } as unknown as OrderAuditService;
    const service = new GamGranularityPlanService(orderAudit, engine);
    const sourcePlan = planning.plan({
      mode: 'recommend',
      currency: 'USD',
      standardGranularity: 'medium',
      minimumHistoricalSamples: 100,
    });

    const result = await service.plan(undefined, '100', sourcePlan, {
      namePrefix: 'Prebid',
      priority: 12,
      lineItemType: 'PRICE_PRIORITY',
      costType: 'CPM',
      creativePlaceholderSizes: ['1x1'],
      simultaneousAdUnits: 1,
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.summary.lineItemsToCreate).toBe(0);
    expect(result.conflicts.some((item) => item.code === 'GRANULARITY_NOT_SELECTED')).toBe(true);
  });
});

function gamPlanFixture(): OrderAuditResult {
  const lineItems = [
    lineItem('201', '21', '0', true),
    lineItem('202', '22', '0.4', true),
    lineItem('203', '23', '1.5', true),
    lineItem('204', '', '2', false),
  ];
  return {
    summary: {
      orders: 1,
      lineItems: lineItems.length,
      creatives: 1,
      associations: 1,
      adUnits: 0,
      placements: 0,
      info: 0,
      warnings: 0,
      high: 0,
      errors: 0,
      partial: false,
    },
    order: normalOrder,
    lineItems,
    creatives: [{ ...normalCreative, id: '400', sizes: [size()] }],
    associations: [{ lineItemId: '202', creativeId: '400', status: 'ACTIVE', sizes: [size()] }],
    customTargeting: [
      {
        id: '20',
        name: 'networks/12345678/customTargetingKeys/20',
        displayName: 'hb_pb',
        status: 'ACTIVE',
        values: [
          targetingValue('21', '0.00'),
          targetingValue('22', '0.50'),
          targetingValue('23', '1.50'),
          targetingValue('24', '1.00'),
        ],
      },
    ],
    findings: [],
  };
}

function lineItem(id: string, valueId: string, cpm: string, prebid: boolean): LineItem {
  return {
    id,
    name: `networks/12345678/lineItems/${id}`,
    displayName: `Prebid ${id}`,
    orderId: '100',
    status: 'DELIVERING',
    lineItemType: 'PRICE_PRIORITY',
    priority: 12,
    costType: 'CPM',
    costPerUnit: { currencyCode: 'USD', micros: String(Number(cpm) * 1_000_000) },
    sameAdvertiserExceptionEnabled: true,
    archived: false,
    missingCreatives: false,
    sizes: [{ ...size(), expectedCreativeCount: 2 }],
    targeting: {
      adUnitIds: [],
      excludedAdUnitIds: [],
      placementIds: [],
      customCriteria: prebid ? [{ keyId: '20', valueIds: [valueId], operator: 'IS' }] : [],
    },
  };
}

function targetingValue(id: string, displayName: string) {
  return {
    id,
    name: `networks/12345678/customTargetingKeys/20/customTargetingValues/${id}`,
    displayName,
    status: 'ACTIVE',
  };
}

function size() {
  return { width: 1, height: 1, canonicalName: '1x1' };
}
