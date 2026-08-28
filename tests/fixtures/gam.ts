import type {
  AdUnit,
  Creative,
  CustomTargetingKey,
  LineItem,
  LineItemCreativeAssociation,
  Order,
  Placement,
} from '../../src/gam/models/resources.js';

export const normalOrder: Order = {
  id: '100',
  name: 'networks/12345678/orders/100',
  displayName: 'Normal Order',
  advertiserId: '900',
  status: 'APPROVED',
  currencyCode: 'BRL',
  archived: false,
};

export const emptyOrder: Order = {
  ...normalOrder,
  id: '101',
  name: 'networks/12345678/orders/101',
  displayName: 'Empty Order',
  status: 'DRAFT',
};

export const normalLineItem: LineItem = {
  id: '200',
  name: 'networks/12345678/lineItems/200',
  displayName: 'Homepage 300x250',
  orderId: '100',
  status: 'DELIVERING',
  lineItemType: 'STANDARD',
  priority: 8,
  costType: 'CPM',
  costPerUnit: { currencyCode: 'BRL', micros: '2500000' },
  archived: false,
  missingCreatives: false,
  sizes: [{ width: 300, height: 250, canonicalName: '300x250' }],
  targeting: {
    adUnitIds: ['300'],
    excludedAdUnitIds: [],
    placementIds: [],
    customCriteria: [{ keyId: '10', valueIds: ['11'], operator: 'IS' }],
  },
};

export const normalCreative: Creative = {
  id: '400',
  name: 'Homepage creative',
  advertiserId: '900',
  status: 'ACTIVE',
  type: 'ImageCreative',
  sizes: [{ width: 300, height: 250, canonicalName: '300x250' }],
};

export const incorrectCreative: Creative = {
  ...normalCreative,
  id: '401',
  name: 'Wrong size creative',
  sizes: [{ width: 728, height: 90, canonicalName: '728x90' }],
};

export const normalAssociation: LineItemCreativeAssociation = {
  lineItemId: '200',
  creativeId: '400',
  status: 'ACTIVE',
  sizes: [{ width: 300, height: 250, canonicalName: '300x250' }],
};

export const customTargetingKey: CustomTargetingKey = {
  id: '10',
  name: 'networks/12345678/customTargetingKeys/10',
  displayName: 'position',
  status: 'ACTIVE',
  type: 'PREDEFINED',
  values: [
    {
      id: '11',
      name: 'networks/12345678/customTargetingKeys/10/customTargetingValues/11',
      displayName: 'homepage',
      status: 'ACTIVE',
    },
  ],
};

export const adUnit: AdUnit = {
  id: '300',
  name: 'networks/12345678/adUnits/300',
  displayName: 'Homepage',
  code: 'homepage',
  status: 'ACTIVE',
  sizes: [{ width: 300, height: 250, canonicalName: '300x250' }],
};

export const placement: Placement = {
  id: '500',
  name: 'networks/12345678/placements/500',
  displayName: 'Homepage placement',
  status: 'ACTIVE',
  adUnitIds: ['300'],
};

export function hundredsOfLineItems(count = 425): LineItem[] {
  return Array.from({ length: count }, (_, index) => ({
    ...normalLineItem,
    id: String(1_000 + index),
    name: `networks/12345678/lineItems/${1_000 + index}`,
    displayName: `Line Item ${index}`,
  }));
}
