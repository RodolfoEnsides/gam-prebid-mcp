import { describe, expect, it } from 'vitest';

import {
  createCreativeInputSchema,
  createOrderInputSchema,
  updateLineItemInputSchema,
} from '../../src/tools/write-schemas.js';

describe('write tool schemas', () => {
  it('defaults dry-run and requires exactly one singular or bulk input', () => {
    const parsed = createOrderInputSchema.parse({
      order: { name: 'Order', advertiserId: '900', traffickerId: '901' },
    });
    expect(parsed.dryRun).toBe(true);
    expect(createOrderInputSchema.safeParse({}).success).toBe(false);
    expect(
      createOrderInputSchema.safeParse({
        order: { name: 'One', advertiserId: '900', traffickerId: '901' },
        orders: [{ name: 'Two', advertiserId: '900', traffickerId: '901' }],
      }).success,
    ).toBe(false);
  });

  it('uses explicit allowlisted update fields and rejects generic payloads', () => {
    expect(
      updateLineItemInputSchema.safeParse({
        update: { lineItemId: '200', patch: { priority: 12, arbitraryField: true } },
      }).success,
    ).toBe(false);
    expect(
      updateLineItemInputSchema.safeParse({
        update: { lineItemId: '200', patch: { priority: 12 } },
        dryRun: false,
      }).success,
    ).toBe(true);
  });

  it('supports only the explicitly typed ThirdPartyCreative in this stage', () => {
    expect(
      createCreativeInputSchema.safeParse({
        creative: {
          creativeType: 'IMAGE',
          contextOrderId: '100',
          advertiserId: '900',
          name: 'Creative',
          size: { width: 1, height: 1 },
          snippet: '<script></script>',
        },
      }).success,
    ).toBe(false);
  });
});
