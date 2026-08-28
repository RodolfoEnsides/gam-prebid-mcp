import { describe, expect, it } from 'vitest';

import {
  gamPlanPrebidGranularityInputSchema,
  prebidPlanGranularityInputSchema,
  prebidSimulateGranularityInputSchema,
} from '../../src/tools/granularity-planning-schemas.js';

describe('granularity planning schemas', () => {
  it('requires custom ranges only in custom mode', () => {
    expect(prebidPlanGranularityInputSchema.safeParse({ mode: 'custom' }).success).toBe(false);
    expect(
      prebidPlanGranularityInputSchema.safeParse({
        mode: 'custom',
        customGranularity: { buckets: [{ max: 2, increment: 0.1, precision: 2 }] },
      }).success,
    ).toBe(true);
    expect(prebidPlanGranularityInputSchema.safeParse({ mode: 'recommend' }).success).toBe(true);
  });

  it('validates weighted history and unique simulation alternatives', () => {
    expect(
      prebidSimulateGranularityInputSchema.safeParse({
        alternatives: ['medium'],
        customAlternatives: [
          {
            name: 'custom_278',
            granularity: { buckets: [{ max: 10, increment: 0.05 }] },
          },
        ],
        historicalData: { histogram: [{ cpm: 1.25, count: 500 }] },
      }).success,
    ).toBe(true);
    expect(
      prebidSimulateGranularityInputSchema.safeParse({
        alternatives: ['medium'],
        customAlternatives: [
          { name: 'medium', granularity: { buckets: [{ max: 10, increment: 0.05 }] } },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires an Order and creative placeholder sizes for a GAM plan', () => {
    expect(
      gamPlanPrebidGranularityInputSchema.safeParse({
        mode: 'dense',
        orderId: '12345',
        lineItemTemplate: { creativePlaceholderSizes: ['1x1', '300x250'] },
      }).success,
    ).toBe(true);
    expect(
      gamPlanPrebidGranularityInputSchema.safeParse({
        mode: 'dense',
        orderId: 'bad',
        lineItemTemplate: { creativePlaceholderSizes: [] },
      }).success,
    ).toBe(false);
  });
});
