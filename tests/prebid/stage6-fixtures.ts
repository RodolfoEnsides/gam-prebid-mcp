import type { OrderAuditResult } from '../../src/audit/models.js';
import type { LineItem } from '../../src/gam/models/resources.js';

export function applicationAuditFixture(): OrderAuditResult {
  const lineItems = [lineItem('201', '21', '0'), lineItem('202', '22', '0.5')];
  return {
    summary: {
      orders: 1,
      lineItems: 2,
      creatives: 1,
      associations: 2,
      adUnits: 0,
      placements: 0,
      info: 0,
      warnings: 0,
      high: 0,
      errors: 0,
      partial: false,
    },
    order: {
      id: '100',
      name: 'networks/12345678/orders/100',
      displayName: 'Prebid Order',
      advertiserId: '300',
      currencyCode: 'USD',
      status: 'APPROVED',
      archived: false,
    },
    lineItems,
    creatives: [
      {
        id: '400',
        name: 'Creative 400',
        advertiserId: '300',
        status: 'ACTIVE',
        type: 'ThirdPartyCreative',
        prebidUniversalCreative: true,
        sizes: [size()],
      },
    ],
    associations: lineItems.map((item) => ({
      lineItemId: item.id,
      creativeId: '400',
      status: 'ACTIVE',
      sizes: [size()],
    })),
    customTargeting: [
      {
        id: '20',
        name: 'hb_pb',
        displayName: 'hb_pb',
        status: 'ACTIVE',
        values: [
          { id: '21', name: '0.00', displayName: '0.00', status: 'ACTIVE' },
          { id: '22', name: '0.50', displayName: '0.50', status: 'ACTIVE' },
          { id: '23', name: '1.00', displayName: '1.00', status: 'ACTIVE' },
        ],
      },
    ],
    findings: [],
  };
}

function lineItem(id: string, valueId: string, cpm: string): LineItem {
  return {
    id,
    name: `lineItems/${id}`,
    displayName: `Prebid ${cpm}`,
    orderId: '100',
    status: 'DELIVERING',
    lineItemType: 'PRICE_PRIORITY',
    priority: 12,
    costType: 'CPM',
    costPerUnit: { currencyCode: 'USD', micros: String(Number(cpm) * 1_000_000) },
    sameAdvertiserExceptionEnabled: true,
    startTime: '2026-01-01T00:00:00.000Z',
    endTime: '2027-01-01T00:00:00.000Z',
    unlimitedEndTime: false,
    primaryGoal: { goalType: 'NONE', unitType: 'IMPRESSIONS' },
    archived: false,
    missingCreatives: false,
    sizes: [{ ...size(), expectedCreativeCount: 1 }],
    targeting: {
      adUnitIds: ['500'],
      excludedAdUnitIds: [],
      placementIds: [],
      customCriteria: [{ keyId: '20', valueIds: [valueId], operator: 'IS' }],
    },
  };
}

function size() {
  return { width: 1, height: 1, canonicalName: '1x1' };
}
