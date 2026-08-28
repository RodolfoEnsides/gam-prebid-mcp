import { describe, expect, it } from 'vitest';

import type { OrderAuditService } from '../../src/audit/order-audit-service.js';
import { buildStoredPlan } from '../../src/prebid/application-plan-builder.js';
import { GamGranularityPlanService } from '../../src/prebid/gam-granularity-plan-service.js';
import { GranularityPlanningService } from '../../src/prebid/granularity-planning-service.js';
import { PriceBucketEngine } from '../../src/prebid/price-bucket-engine.js';
import { applicationAuditFixture } from './stage6-fixtures.js';

describe('Stage 6 application plan builder', () => {
  it('creates only the missing bucket and preserves base targeting exactly', () => {
    const audit = applicationAuditFixture();
    audit.lineItems.pop();
    audit.associations.pop();
    audit.summary.lineItems = 1;
    audit.summary.associations = 1;
    const engine = new PriceBucketEngine(100);
    const planning = new GranularityPlanningService(engine);
    const planningRequest = {
      mode: 'custom' as const,
      currency: 'USD',
      standardGranularity: 'medium' as const,
      customGranularity: {
        name: 'custom' as const,
        ranges: [
          { min: 0, max: 0.5, increment: 0.5, precision: 2, cap: true, rounding: 'FLOOR' as const },
        ],
      },
      minimumHistoricalSamples: 100,
    };
    const source = planning.plan(planningRequest);
    const template = {
      namePrefix: 'Prebid USD',
      priority: 12,
      lineItemType: 'PRICE_PRIORITY',
      costType: 'CPM' as const,
      creativePlaceholderSizes: ['1x1'],
      simultaneousAdUnits: 1,
    };
    const gam = new GamGranularityPlanService({} as OrderAuditService, engine).planFromAudit(
      '100',
      source,
      template,
      audit,
    );

    const plan = buildStoredPlan(
      '12345678',
      {
        orderId: '100',
        planning: planningRequest,
        lineItemTemplate: template,
        baseLineItemId: '201',
        creativeStrategy: { mode: 'none' },
      },
      audit,
      gam,
      86_400_000,
    );

    const action = plan.create.find((item) => item.kind === 'CREATE_LINE_ITEM');
    expect(action).toMatchObject({
      kind: 'CREATE_LINE_ITEM',
      input: {
        costPerUnit: { currencyCode: 'USD', micros: '500000' },
        lineItemType: 'PRICE_PRIORITY',
        targeting: { adUnitIds: ['500'] },
      },
    });
    if (action?.kind === 'CREATE_LINE_ITEM') {
      expect(action.input.targeting.customCriteria).toEqual([
        { keyId: '20', valueIds: ['22'], operator: 'IS' },
      ]);
      expect(action.input.externalId).toMatch(/^gpm:/);
    }
    expect(plan.errors).toEqual([]);
    expect(plan.warnings.some((item) => item.startsWith('CREATIVES_NOT_PLANNED'))).toBe(true);
  });
});
