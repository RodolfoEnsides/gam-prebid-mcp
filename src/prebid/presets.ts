import type { PriceGranularityDefinition, StandardGranularity } from './models.js';

const presetRanges: Record<
  StandardGranularity,
  Array<{ max: number; increment: number; precision?: number }>
> = {
  low: [{ max: 5, increment: 0.5 }],
  medium: [{ max: 20, increment: 0.1 }],
  high: [{ max: 20, increment: 0.01 }],
  auto: [
    { max: 5, increment: 0.05 },
    { max: 10, increment: 0.1 },
    { max: 20, increment: 0.5 },
  ],
  dense: [
    { max: 3, increment: 0.01 },
    { max: 8, increment: 0.05 },
    { max: 20, increment: 0.5 },
  ],
};

export function getStandardGranularity(name: StandardGranularity): PriceGranularityDefinition {
  let min = 0;
  const ranges = presetRanges[name].map((bucket, index, buckets) => {
    const range = {
      min,
      max: bucket.max,
      increment: bucket.increment,
      precision: bucket.precision ?? 2,
      cap: index === buckets.length - 1,
      rounding: 'FLOOR' as const,
    };
    min = bucket.max;
    return range;
  });
  return { name, ranges };
}
