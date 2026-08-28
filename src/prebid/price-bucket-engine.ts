import type {
  GeneratedPriceBuckets,
  ParsedPrebidConfig,
  PriceBucketRange,
  PriceGranularityDefinition,
} from './models.js';

export class PriceBucketLimitError extends Error {
  constructor(readonly limit: number) {
    super(`Price bucket generation exceeded the configured limit of ${limit}.`);
    this.name = 'PriceBucketLimitError';
  }
}

export class PriceBucketEngine {
  constructor(private readonly maxBuckets: number) {}

  generate(config: ParsedPrebidConfig): GeneratedPriceBuckets {
    const values = generateValues(config.granularity, this.maxBuckets);
    const first = config.granularity.ranges[0];
    const cap = Math.max(...config.granularity.ranges.map((range) => range.max));
    return {
      mode: 'GAM_WITH_PREBID',
      granularity: config.granularity.name,
      currency: config.currency,
      bucketCount: values.length,
      ranges: config.granularity.ranges,
      min: first?.min ?? 0,
      max: cap,
      cap,
      rounding: 'FLOOR',
      values,
    };
  }

  bucketCpm(cpm: number, definition: PriceGranularityDefinition): string {
    if (!Number.isFinite(cpm) || cpm < 0) throw new Error('CPM must be a non-negative number.');
    const cap = Math.max(...definition.ranges.map((range) => range.max));
    if (cpm > cap) {
      const capRange = definition.ranges.reduce((selected, range) =>
        range.max >= selected.max ? range : selected,
      );
      return cap.toFixed(capRange.precision);
    }

    const range = definition.ranges.find((item) => cpm <= item.max && cpm >= item.min);
    if (!range) return '';
    return floorToRange(cpm, range);
  }
}

function generateValues(definition: PriceGranularityDefinition, limit: number): string[] {
  const values = new Set<string>();
  for (const [rangeIndex, range] of definition.ranges.entries()) {
    const decimals = Math.max(
      decimalPlaces(range.min),
      decimalPlaces(range.max),
      decimalPlaces(range.increment),
      range.precision,
    );
    const scale = 10 ** decimals;
    const min = Math.round(range.min * scale);
    const max = Math.round(range.max * scale);
    const increment = Math.round(range.increment * scale);
    if (increment <= 0) throw new Error('Price bucket increment is too small for its precision.');

    // At a shared boundary Prebid selects the earlier range (`cpm <= max`).
    // Skipping the next range's min prevents an unreachable duplicate when precisions differ.
    const first = rangeIndex === 0 ? min : min + increment;
    for (let current = first; current <= max; current += increment) {
      values.add(Number((current / scale).toFixed(10)).toFixed(range.precision));
      if (values.size > limit) throw new PriceBucketLimitError(limit);
    }
  }

  const capRange = definition.ranges.reduce((selected, range) =>
    range.max >= selected.max ? range : selected,
  );
  values.add(capRange.max.toFixed(capRange.precision));
  if (values.size > limit) throw new PriceBucketLimitError(limit);
  return [...values].sort(
    (left, right) => Number(left) - Number(right) || left.localeCompare(right),
  );
}

function floorToRange(cpm: number, range: PriceBucketRange): string {
  const increment = range.increment;
  const pow = 10 ** (range.precision + 2);
  const cpmToRound = (cpm * pow - range.min * pow) / (increment * pow);
  const target = Math.floor(cpmToRound) * increment + range.min;
  return Number(target.toFixed(10)).toFixed(range.precision);
}

function decimalPlaces(value: number): number {
  const text = value.toString().toLowerCase();
  if (text.includes('e-')) {
    const [coefficient, exponent] = text.split('e-');
    return Number(exponent) + (coefficient?.split('.')[1]?.length ?? 0);
  }
  return text.split('.')[1]?.length ?? 0;
}
