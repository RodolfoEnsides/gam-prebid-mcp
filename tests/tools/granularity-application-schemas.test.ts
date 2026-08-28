import { describe, expect, it } from 'vitest';

import {
  applyGranularityPlanInputSchema,
  createGranularityPlanInputSchema,
} from '../../src/tools/granularity-application-schemas.js';

describe('granularity application schemas', () => {
  it('requires explicit dry-run intent and rejects extra fields', () => {
    expect(
      applyGranularityPlanInputSchema.safeParse({ planId: 'prebid-apply:0123456789abcdef' })
        .success,
    ).toBe(false);
    expect(
      applyGranularityPlanInputSchema.safeParse({
        planId: 'prebid-apply:0123456789abcdef',
        dryRun: false,
        force: true,
      }).success,
    ).toBe(false);
  });

  it('requires explicit clone source and only permits Price Priority automation', () => {
    const base = {
      mode: 'dense',
      orderId: '100',
      lineItemTemplate: { creativePlaceholderSizes: ['1x1'] },
      creativeStrategy: { mode: 'clone' },
    };
    expect(createGranularityPlanInputSchema.safeParse(base).success).toBe(false);
    expect(
      createGranularityPlanInputSchema.safeParse({
        ...base,
        lineItemTemplate: {
          creativePlaceholderSizes: ['1x1'],
          lineItemType: 'STANDARD',
        },
        creativeStrategy: { mode: 'none' },
      }).success,
    ).toBe(false);
  });
});
