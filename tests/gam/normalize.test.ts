import { describe, expect, it } from 'vitest';

import { normalizeLineItem } from '../../src/gam/models/normalize.js';

const baseLineItem = {
  name: 'networks/1560616/lineItems/7401192891',
  displayName: 'Prebid - banner - 0.20',
  order: 'networks/1560616/orders/4030556299',
  costType: 'CPM',
  targeting: {},
};

describe('normalizeLineItem', () => {
  it('normalizes the REST v1 rate into costPerUnit micros and currency', () => {
    const lineItem = normalizeLineItem({
      ...baseLineItem,
      rate: { currencyCode: 'USD', units: '0', nanos: 200_000_000 },
    });

    expect(lineItem.costPerUnit).toEqual({ currencyCode: 'USD', micros: '200000' });
  });

  it('keeps supporting the SOAP costPerUnit representation used by writes', () => {
    const lineItem = normalizeLineItem({
      ...baseLineItem,
      costPerUnit: { currencyCode: 'USD', microAmount: '200000' },
    });

    expect(lineItem.costPerUnit).toEqual({ currencyCode: 'USD', micros: '200000' });
  });

  it('normalizes the SOAP same-advertiser competitive exclusion field', () => {
    const lineItem = normalizeLineItem({
      ...baseLineItem,
      disableSameAdvertiserCompetitiveExclusion: true,
    });

    expect(lineItem.sameAdvertiserExceptionEnabled).toBe(true);
  });

  it('normalizes the real REST Line Item shape without losing targeting semantics', () => {
    const lineItem = normalizeLineItem({
      ...baseLineItem,
      rate: { currencyCode: 'USD', nanos: 200_000_000 },
      valueCpm: { currencyCode: 'USD', units: '0', nanos: 0 },
      goal: { goalType: 'NONE', unitType: 'IMPRESSIONS', units: '-1' },
      endTime: '2037-01-01T08:00:00Z',
      endTimeUnlimited: true,
      creativeRotationType: 'OPTIMIZED',
      deliveryRateType: 'EVENLY',
      deliveryForecastSource: 'HISTORICAL',
      roadblockingType: 'ONE_OR_MORE',
      environmentType: 'BROWSER',
      sameAdvertiserExceptionEnabled: false,
      repeatedCreativeServingEnabled: false,
      creativePlaceholders: [
        {
          size: { width: 1, height: 1, sizeType: 'PIXEL' },
          expectedCreativeCount: 5,
        },
      ],
      targeting: {
        inventoryTargeting: {
          targetedAdUnits: [
            {
              adUnit: 'networks/1560616/adUnits/560706',
              includeDescendants: false,
            },
          ],
        },
        customTargeting: {
          customTargetingClauses: [
            {
              customTargetingLiterals: [
                {
                  customTargetingKey: 'networks/1560616/customTargetingKeys/11890116',
                  customTargetingValues: [
                    'networks/1560616/customTargetingKeys/11890116/customTargetingValues/448095198807',
                  ],
                  negative: false,
                },
                {
                  customTargetingKey: 'networks/1560616/customTargetingKeys/11890050',
                  customTargetingValues: [
                    'networks/1560616/customTargetingKeys/11890050/customTargetingValues/448094903107',
                  ],
                  negative: false,
                },
              ],
            },
          ],
        },
      },
    });

    expect(lineItem).toMatchObject({
      costPerUnit: { currencyCode: 'USD', micros: '200000' },
      primaryGoal: { goalType: 'NONE', unitType: 'IMPRESSIONS', units: '-1' },
      unlimitedEndTime: true,
      creativeRotationType: 'OPTIMIZED',
      deliveryRateType: 'EVENLY',
      deliveryForecastSource: 'HISTORICAL',
      sameAdvertiserExceptionEnabled: false,
      sizes: [{ canonicalName: '1x1', expectedCreativeCount: 5 }],
      targeting: {
        adUnitIds: ['560706'],
        adUnits: [{ id: '560706', includeDescendants: false }],
        customCriteria: [
          { keyId: '11890116', valueIds: ['448095198807'], operator: 'IS' },
          { keyId: '11890050', valueIds: ['448094903107'], operator: 'IS' },
        ],
        customTargeting: {
          type: 'SET',
          logicalOperator: 'AND',
        },
      },
    });
    expect(lineItem.targeting.unsupportedPaths).toBeUndefined();
  });

  it('preserves OR clauses, negative criteria, and reports unsupported targeting', () => {
    const lineItem = normalizeLineItem({
      ...baseLineItem,
      targeting: {
        geoTargeting: { targetedGeos: ['geoTargeting/2036'] },
        customTargeting: {
          customTargetingClauses: [
            {
              customTargetingLiterals: [
                {
                  customTargetingKey: 'customTargetingKeys/10',
                  customTargetingValues: ['customTargetingValues/11'],
                  negative: true,
                },
              ],
            },
            {
              customTargetingLiterals: [
                {
                  customTargetingKey: 'customTargetingKeys/20',
                  customTargetingValues: ['customTargetingValues/21'],
                  negative: false,
                },
              ],
            },
          ],
        },
      },
    });

    expect(lineItem.targeting.customTargeting).toMatchObject({
      type: 'SET',
      logicalOperator: 'OR',
      children: [
        {
          type: 'SET',
          logicalOperator: 'AND',
          children: [{ type: 'CRITERION', keyId: '10', operator: 'IS_NOT' }],
        },
        {
          type: 'SET',
          logicalOperator: 'AND',
          children: [{ type: 'CRITERION', keyId: '20', operator: 'IS' }],
        },
      ],
    });
    expect(lineItem.targeting.unsupportedPaths).toEqual(['geoTargeting']);
  });

  it('normalizes the SOAP custom targeting tree used by clone and write verification', () => {
    const lineItem = normalizeLineItem({
      id: '7401192891',
      name: 'Prebid - banner - 0.20',
      orderId: '4030556299',
      costPerUnit: { currencyCode: 'USD', microAmount: '200000' },
      targeting: {
        inventoryTargeting: {
          targetedAdUnits: [{ adUnitId: '560706', includeDescendants: false }],
        },
        customTargeting: {
          logicalOperator: 'AND',
          children: [
            { keyId: '11890116', valueIds: ['448095198807'], operator: 'IS' },
            { keyId: '11890050', valueIds: ['448094903107'], operator: 'IS' },
          ],
        },
      },
    });

    expect(lineItem.targeting.adUnits).toEqual([{ id: '560706', includeDescendants: false }]);
    expect(lineItem.targeting.customTargeting).toMatchObject({
      type: 'SET',
      logicalOperator: 'AND',
    });
    expect(lineItem.targeting.customCriteria).toHaveLength(2);
  });
});
