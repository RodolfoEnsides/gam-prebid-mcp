import { describe, expect, it, vi } from 'vitest';

import type { GamSoapAdapter } from '../../src/gam/adapters/gam-soap-adapter.js';
import type { LineItem } from '../../src/gam/models/resources.js';
import type { LineItemCreate } from '../../src/gam/models/write-models.js';
import { DefaultGamWriteRepository } from '../../src/gam/repositories/write-repository.js';

describe('DefaultGamWriteRepository Line Item payloads', () => {
  it('serializes a lossless targeting tree and explicit Prebid delivery settings', async () => {
    const mutate = vi.fn(async (input: unknown) => {
      void input;
      return [soapLineItem()];
    });
    const repository = new DefaultGamWriteRepository({ mutate } as unknown as GamSoapAdapter);

    await repository.createLineItem(lineItemCreate());

    const payload = (mutate.mock.calls[0]?.[0] as { values: Record<string, unknown>[] }).values[0];
    expect(payload).toMatchObject({
      costPerUnit: { currencyCode: 'USD', microAmount: '200000' },
      creativeRotationType: 'OPTIMIZED',
      deliveryRateType: 'EVENLY',
      deliveryForecastSource: 'HISTORICAL',
      disableSameAdvertiserCompetitiveExclusion: true,
      creativePlaceholders: [
        {
          size: { width: 1, height: 1 },
          expectedCreativeCount: 5,
        },
      ],
      targeting: {
        inventoryTargeting: {
          targetedAdUnits: [{ adUnitId: '560706', includeDescendants: false }],
        },
        customTargeting: {
          __type: 'CustomCriteriaSet',
          logicalOperator: 'AND',
          children: [
            {
              __type: 'CustomCriteria',
              keyId: '11890116',
              valueIds: ['448095198807'],
              operator: 'IS',
            },
            {
              __type: 'CustomCriteria',
              keyId: '11890050',
              valueIds: ['448094903107'],
              operator: 'IS',
            },
          ],
        },
      },
    });
  });

  it('keeps unmodeled SOAP targeting while applying typed clone overrides', async () => {
    const mutate = vi.fn(async (input: unknown) => {
      void input;
      return [soapLineItem()];
    });
    const repository = new DefaultGamWriteRepository({ mutate } as unknown as GamSoapAdapter);
    const source = soapLineItem();
    source.targeting = {
      geoTargeting: { targetedLocations: [{ id: '2036' }] },
      technologyTargeting: { deviceCategoryTargeting: { targetedDeviceCategories: ['30000'] } },
      inventoryTargeting: { targetedAdUnits: [{ adUnitId: '560706', includeDescendants: false }] },
    };

    await repository.cloneLineItem(
      { resource: normalizedLineItem(), raw: source },
      {
        sourceLineItemId: '7401192891',
        targetOrderId: '4030556299',
        name: 'Prebid - banner - 0.21',
        overrides: {
          costPerUnit: { currencyCode: 'USD', micros: '210000' },
          sameAdvertiserExceptionEnabled: true,
        },
      },
    );

    const payload = (mutate.mock.calls[0]?.[0] as { values: Record<string, unknown>[] }).values[0];
    expect(payload).toMatchObject({
      orderId: '4030556299',
      name: 'Prebid - banner - 0.21',
      costPerUnit: { currencyCode: 'USD', microAmount: '210000' },
      disableSameAdvertiserCompetitiveExclusion: true,
      targeting: source.targeting,
    });
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('status');
  });

  it('maps the public same-advertiser setting to the SOAP update field', async () => {
    const mutate = vi.fn(async (input: unknown) => {
      void input;
      return [{ ...soapLineItem(), disableSameAdvertiserCompetitiveExclusion: true }];
    });
    const repository = new DefaultGamWriteRepository({ mutate } as unknown as GamSoapAdapter);
    const raw = soapLineItem();
    Object.assign(raw, {
      orderName: 'Prebid Header Bidding',
      reservationStatus: 'UNRESERVED',
      isMissingCreatives: false,
      lastModifiedByApp: 'gam-prebid-mcp',
      targeting: {
        customTargeting: {
          '@_xsi:type': 'CustomCriteriaSet',
          logicalOperator: 'AND',
          children: [
            {
              '@_xsi:type': 'CustomCriteria',
              keyId: '11890116',
              valueIds: ['448095198807'],
              operator: 'IS',
            },
          ],
        },
      },
    });

    await repository.updateLineItem(
      { resource: normalizedLineItem(), raw },
      {
        lineItemId: '7401192891',
        patch: { sameAdvertiserExceptionEnabled: true },
      },
    );

    const payload = (mutate.mock.calls[0]?.[0] as { values: Record<string, unknown>[] }).values[0];
    expect(payload).toMatchObject({
      id: '7401192891',
      orderId: '4030556299',
      disableSameAdvertiserCompetitiveExclusion: true,
    });
    expect(payload).not.toHaveProperty('sameAdvertiserExceptionEnabled');
    expect(payload).not.toHaveProperty('orderName');
    expect(payload).not.toHaveProperty('reservationStatus');
    expect(payload).not.toHaveProperty('isMissingCreatives');
    expect(payload).not.toHaveProperty('lastModifiedByApp');
    expect(payload).toMatchObject({
      targeting: {
        customTargeting: {
          __type: 'CustomCriteriaSet',
          children: [{ __type: 'CustomCriteria' }],
        },
      },
    });
    expect(JSON.stringify(payload)).not.toContain('@_xsi:type');
  });
});

function lineItemCreate(): LineItemCreate {
  return {
    orderId: '4030556299',
    name: 'Prebid - banner - 0.20',
    lineItemType: 'PRICE_PRIORITY',
    priority: 12,
    costType: 'CPM',
    costPerUnit: { currencyCode: 'USD', micros: '200000' },
    startTime: '2026-08-18T15:00:00Z',
    unlimitedEndTime: true,
    creativePlaceholderSizes: [
      { width: 1, height: 1, canonicalName: '1x1', expectedCreativeCount: 5 },
    ],
    targeting: {
      adUnitIds: ['560706'],
      excludedAdUnitIds: [],
      placementIds: [],
      adUnits: [{ id: '560706', includeDescendants: false }],
      customCriteria: [
        { keyId: '11890116', valueIds: ['448095198807'], operator: 'IS' },
        { keyId: '11890050', valueIds: ['448094903107'], operator: 'IS' },
      ],
      customTargeting: {
        type: 'SET',
        logicalOperator: 'AND',
        children: [
          {
            type: 'CRITERION',
            keyId: '11890116',
            valueIds: ['448095198807'],
            operator: 'IS',
          },
          {
            type: 'CRITERION',
            keyId: '11890050',
            valueIds: ['448094903107'],
            operator: 'IS',
          },
        ],
      },
    },
    primaryGoal: { goalType: 'NONE', unitType: 'IMPRESSIONS', units: '-1' },
    creativeRotationType: 'OPTIMIZED',
    deliveryRateType: 'EVENLY',
    deliveryForecastSource: 'HISTORICAL',
    roadblockingType: 'ONE_OR_MORE',
    environmentType: 'BROWSER',
    sameAdvertiserExceptionEnabled: true,
    repeatedCreativeServingEnabled: false,
  };
}

function soapLineItem(): Record<string, unknown> {
  return {
    id: '7401192891',
    orderId: '4030556299',
    name: 'Prebid - banner - 0.20',
    status: 'READY',
    lineItemType: 'PRICE_PRIORITY',
    priority: 12,
    costType: 'CPM',
    costPerUnit: { currencyCode: 'USD', microAmount: '200000' },
    startDateTime: '2026-08-18T15:00:00Z',
    unlimitedEndDateTime: true,
    creativePlaceholders: [{ size: { width: 1, height: 1 }, expectedCreativeCount: 5 }],
    targeting: {},
    primaryGoal: { goalType: 'NONE', unitType: 'IMPRESSIONS', units: '-1' },
  };
}

function normalizedLineItem(): LineItem {
  return {
    id: '7401192891',
    name: 'Prebid - banner - 0.20',
    displayName: 'Prebid - banner - 0.20',
    orderId: '4030556299',
    archived: false,
    missingCreatives: false,
    sizes: [{ width: 1, height: 1, canonicalName: '1x1' }],
    targeting: {
      adUnitIds: ['560706'],
      excludedAdUnitIds: [],
      placementIds: [],
      customCriteria: [],
    },
  };
}
