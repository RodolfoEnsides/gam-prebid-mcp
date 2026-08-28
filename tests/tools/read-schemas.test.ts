import { describe, expect, it } from 'vitest';

import { lineItemListInputSchema, orderGetInputSchema } from '../../src/tools/read-schemas.js';

describe('read tool schemas', () => {
  it('rejects malformed IDs and unknown fields', () => {
    expect(orderGetInputSchema.safeParse({ orderId: 'abc' }).success).toBe(false);
    expect(orderGetInputSchema.safeParse({ orderId: '123', mutate: true }).success).toBe(false);
  });

  it('accepts structured Line Item filters', () => {
    expect(
      lineItemListInputSchema.safeParse({
        orderId: '100',
        lineItemType: 'STANDARD',
        status: 'DELIVERING',
        startDate: '2026-01-01',
        customTargetingKeyId: '10',
        adUnitId: '300',
        limit: 500,
      }).success,
    ).toBe(true);
  });
});
