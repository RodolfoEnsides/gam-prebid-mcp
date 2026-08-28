import { describe, expect, it } from 'vitest';

import { prebidOrderInputSchema, prebidSourceInputSchema } from '../../src/tools/prebid-schemas.js';

describe('Prebid tool schemas', () => {
  it('requires exactly one safe configuration source', () => {
    expect(
      prebidSourceInputSchema.safeParse({ config: { priceGranularity: 'dense' } }).success,
    ).toBe(true);
    expect(prebidSourceInputSchema.safeParse({ filePath: 'prebid.config.json' }).success).toBe(
      true,
    );
    expect(prebidSourceInputSchema.safeParse({}).success).toBe(false);
    expect(prebidSourceInputSchema.safeParse({ config: {}, filePath: 'config.json' }).success).toBe(
      false,
    );
  });

  it('validates Order ID and simultaneous Ad Unit bounds', () => {
    expect(
      prebidOrderInputSchema.safeParse({
        config: { priceGranularity: 'auto' },
        orderId: '123',
        simultaneousAdUnits: 5,
      }).success,
    ).toBe(true);
    expect(
      prebidOrderInputSchema.safeParse({ config: {}, orderId: 'bad', simultaneousAdUnits: 0 })
        .success,
    ).toBe(false);
  });
});
