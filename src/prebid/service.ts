import type { ParsedPrebidConfig, PrebidConfigSource } from './models.js';
import type { PrebidConfigLoader } from './config-loader.js';
import type { PriceBucketEngine } from './price-bucket-engine.js';

export class PrebidService {
  constructor(
    private readonly loader: PrebidConfigLoader,
    private readonly engine: PriceBucketEngine,
  ) {}

  parse(source: PrebidConfigSource): Promise<ParsedPrebidConfig> {
    return this.loader.load(source);
  }

  async generate(source: PrebidConfigSource) {
    const config = await this.loader.load(source);
    return this.engine.generate(config);
  }

  async analyze(source: PrebidConfigSource) {
    const config = await this.loader.load(source);
    const generated = this.engine.generate(config);
    return {
      mode: config.mode,
      granularity: generated.granularity,
      currency: generated.currency,
      bucketCount: generated.bucketCount,
      ranges: generated.ranges,
      min: generated.min,
      max: generated.max,
      cap: generated.cap,
      rounding: generated.rounding,
      targetingKeys: config.targetingKeys,
      universalCreative: config.universalCreative,
      warnings: config.warnings,
    };
  }
}
