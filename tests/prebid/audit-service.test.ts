import { describe, expect, it } from 'vitest';

import type { OrderAuditResult } from '../../src/audit/models.js';
import type { OrderAuditService } from '../../src/audit/order-audit-service.js';
import type {
  CustomTargetingKey,
  LineItem,
  LineItemCreativeAssociation,
} from '../../src/gam/models/resources.js';
import { PrebidAuditService } from '../../src/prebid/audit-service.js';
import { PrebidConfigLoader } from '../../src/prebid/config-loader.js';
import { PriceBucketEngine } from '../../src/prebid/price-bucket-engine.js';
import { normalAssociation, normalCreative, normalLineItem, normalOrder } from '../fixtures/gam.js';
import { createTestConfig } from '../helpers.js';

describe('PrebidAuditService', () => {
  it('detects missing/extra buckets, precision, CPM, targeting, duplicates, and creatives', async () => {
    const audit = comparisonFixture();
    const orderAudit = { execute: async () => audit } as unknown as OrderAuditService;
    const engine = new PriceBucketEngine(100_000);
    const service = new PrebidAuditService(orderAudit, engine);
    const config = await new PrebidConfigLoader(createTestConfig().prebid).load({
      config: {
        priceGranularity: { buckets: [{ max: 1, increment: 0.5, precision: 2 }] },
        currency: 'USD',
        targetingKeys: ['hb_pb', 'hb_bidder'],
        universalCreative: {
          enabled: true,
          require1x1: true,
          expectedSizes: ['1x1'],
        },
      },
    });

    const result = await service.compare({
      orderId: '100',
      config,
      simultaneousAdUnits: 2,
    });

    expect(result.summary).toMatchObject({
      expectedBuckets: 3,
      existingBuckets: 3,
      correctBuckets: 1,
      missingBuckets: 2,
      extraBuckets: 2,
      targetingProblems: 1,
      precisionProblems: 1,
      duplicates: 1,
    });
    expect(result.problems.cpm.some((item) => item.code === 'PREBID_CPM_MISMATCH')).toBe(true);
    expect(result.existing.currency).toBe('USD');
    expect(result.problems.cpm.some((item) => item.code === 'PREBID_CURRENCY_MISMATCH')).toBe(
      false,
    );
    expect(
      result.problems.creative.some(
        (item) => item.code === 'PREBID_UNIVERSAL_CREATIVE_NOT_DETECTED',
      ),
    ).toBe(true);
    expect(result.findings.every((finding) => finding.severity !== undefined)).toBe(true);
  });

  it('does not require optional targeting keys unless explicitly configured', async () => {
    const audit = comparisonFixture();
    const orderAudit = { execute: async () => audit } as unknown as OrderAuditService;
    const service = new PrebidAuditService(orderAudit, new PriceBucketEngine(100_000));
    const config = await new PrebidConfigLoader(createTestConfig().prebid).load({
      config: { priceGranularity: 'low' },
    });

    const result = await service.validateTargeting({
      orderId: '100',
      config,
      simultaneousAdUnits: 1,
    });

    expect(result.valid).toBe(true);
    expect(result.requiredKeys).toEqual(['hb_pb']);
  });
});

function comparisonFixture(): OrderAuditResult {
  const hbPb: CustomTargetingKey = {
    id: '20',
    name: 'networks/12345678/customTargetingKeys/20',
    displayName: 'hb_pb',
    status: 'ACTIVE',
    type: 'PREDEFINED',
    values: [value('21', '0'), value('22', '0.50'), value('23', '1.50')],
  };
  const lineItems: LineItem[] = [
    prebidLineItem('201', '21', '0'),
    prebidLineItem('202', '22', '0.4'),
    prebidLineItem('203', '22', '0.5'),
    prebidLineItem('204', '23', '1.5'),
  ];
  const associations: LineItemCreativeAssociation[] = lineItems.map((lineItem) => ({
    ...normalAssociation,
    lineItemId: lineItem.id,
  }));
  return {
    summary: {
      orders: 1,
      lineItems: lineItems.length,
      creatives: 1,
      associations: associations.length,
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
    creatives: [{ ...normalCreative, prebidUniversalCreative: false }],
    associations,
    customTargeting: [hbPb],
    findings: [],
  };
}

function prebidLineItem(id: string, valueId: string, cpm: string): LineItem {
  return {
    ...normalLineItem,
    id,
    costPerUnit: { currencyCode: 'USD', micros: String(Number(cpm) * 1_000_000) },
    targeting: {
      ...normalLineItem.targeting,
      customCriteria: [{ keyId: '20', valueIds: [valueId], operator: 'IS' }],
    },
  };
}

function value(id: string, displayName: string) {
  return {
    id,
    name: `networks/12345678/customTargetingKeys/20/customTargetingValues/${id}`,
    displayName,
    status: 'ACTIVE',
  };
}
