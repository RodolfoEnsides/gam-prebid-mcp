import { describe, expect, it } from 'vitest';

import { PrebidConfigLoader } from '../../src/prebid/config-loader.js';
import { PriceBucketEngine, PriceBucketLimitError } from '../../src/prebid/price-bucket-engine.js';
import { createTestConfig } from '../helpers.js';

describe('PriceBucketEngine', () => {
  const loader = new PrebidConfigLoader(createTestConfig().prebid);
  const engine = new PriceBucketEngine(100_000);

  it.each([
    ['low', 11],
    ['medium', 201],
    ['high', 2_001],
    ['auto', 171],
    ['dense', 425],
  ] as const)('matches the official %s preset bucket count', async (granularity, count) => {
    const config = await loader.load({ config: { priceGranularity: granularity } });
    const result = engine.generate(config);

    expect(result.bucketCount).toBe(count);
    expect(result.values[0]).toBe('0.00');
  });

  it('preserves dense boundaries, precision, floor rounding, and cap', async () => {
    const config = await loader.load({ config: { priceGranularity: 'dense' } });

    expect(engine.bucketCpm(3.04, config.granularity)).toBe('3.00');
    expect(engine.bucketCpm(5.09, config.granularity)).toBe('5.05');
    expect(engine.bucketCpm(14.26, config.granularity)).toBe('14.00');
    expect(engine.bucketCpm(24.82, config.granularity)).toBe('20.00');
    expect(engine.generate(config).values).toContain('8.00');
  });

  it('supports custom ranges with independent precision', async () => {
    const config = await loader.load({
      config: {
        priceGranularity: {
          buckets: [
            { max: 1, increment: 0.1, precision: 2 },
            { max: 2, increment: 0.25, precision: 3 },
          ],
        },
      },
    });

    const result = engine.generate(config);
    expect(result.values).toContain('1.250');
    expect(result.values).not.toContain('1.000');
    expect(engine.bucketCpm(1.49, config.granularity)).toBe('1.250');
    expect(engine.bucketCpm(3, config.granularity)).toBe('2.000');
  });

  it('enforces the configured generation ceiling', async () => {
    const config = await loader.load({ config: { priceGranularity: 'high' } });
    expect(() => new PriceBucketEngine(10).generate(config)).toThrow(PriceBucketLimitError);
  });
});
