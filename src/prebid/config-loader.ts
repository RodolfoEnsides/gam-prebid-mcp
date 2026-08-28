import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { AppConfig } from '../config/env.js';
import { asArray, asRecord } from '../gam/models/normalize.js';
import { prebidConfigSchema, type RawPrebidConfig } from './config-schema.js';
import type {
  ParsedPrebidConfig,
  PrebidConfigSource,
  PrebidTargetingKey,
  PriceGranularityDefinition,
} from './models.js';
import { PREBID_TARGETING_KEYS } from './models.js';
import { getStandardGranularity } from './presets.js';

export class PrebidConfigInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrebidConfigInputError';
  }
}

export class PrebidConfigLoader {
  constructor(private readonly config: AppConfig['prebid']) {}

  async load(source: PrebidConfigSource): Promise<ParsedPrebidConfig> {
    if ((source.config === undefined) === (source.filePath === undefined)) {
      throw new PrebidConfigInputError('Provide exactly one of config or filePath.');
    }
    if (source.filePath) {
      const { value, sourcePath } = await this.readJsonFile(source.filePath);
      return this.parse(value, 'FILE', sourcePath);
    }
    return this.parse(source.config, 'DIRECT');
  }

  private parse(
    value: unknown,
    source: 'DIRECT' | 'FILE',
    sourcePath?: string,
  ): ParsedPrebidConfig {
    const result = prebidConfigSchema.safeParse(value);
    if (!result.success) {
      throw new PrebidConfigInputError(
        `Invalid Prebid configuration: ${result.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    const raw = result.data;
    const warnings: string[] = [];
    const granularity = normalizeGranularity(raw, warnings);
    const explicitKeys = raw.targetingKeys ?? extractBidderSettingKeys(raw.bidderSettings);
    const targetingKeys = explicitKeys.length > 0 ? explicitKeys : defaultTargetingKeys();
    const currency = normalizeCurrency(raw.currency);

    return {
      mode: 'GAM_WITH_PREBID',
      granularity,
      currency,
      targetingKeys,
      targetingKeysExplicit: explicitKeys.length > 0,
      universalCreative: {
        enabled: raw.universalCreative?.enabled ?? true,
        require1x1: raw.universalCreative?.require1x1 ?? false,
        expectedSizes: raw.universalCreative?.expectedSizes ?? [],
      },
      warnings,
      source,
      ...(sourcePath ? { sourcePath } : {}),
    };
  }

  private async readJsonFile(filePath: string): Promise<{ value: unknown; sourcePath: string }> {
    if (path.extname(filePath).toLowerCase() !== '.json') {
      throw new PrebidConfigInputError('Prebid configuration files must use the .json extension.');
    }
    let resolved: string;
    try {
      resolved = await realpath(path.resolve(filePath));
    } catch {
      throw new PrebidConfigInputError('Prebid configuration file could not be read.');
    }
    const allowedDirectories =
      this.config.allowedConfigDirectories.length > 0
        ? await Promise.all(
            this.config.allowedConfigDirectories.map(async (directory) => {
              try {
                return await realpath(directory);
              } catch {
                throw new PrebidConfigInputError(
                  'A configured Prebid file allowlist directory is unavailable.',
                );
              }
            }),
          )
        : [await realpath(process.cwd())];
    if (!allowedDirectories.some((directory) => isWithin(directory, resolved))) {
      throw new PrebidConfigInputError(
        'Prebid configuration file is outside the allowed directories.',
      );
    }
    const metadata = await stat(resolved);
    if (!metadata.isFile())
      throw new PrebidConfigInputError('Prebid configuration path is not a file.');
    if (metadata.size > this.config.maxConfigBytes) {
      throw new PrebidConfigInputError(
        `Prebid configuration exceeds the ${this.config.maxConfigBytes} byte limit.`,
      );
    }
    const content = await readFile(resolved, 'utf8');
    try {
      return { value: JSON.parse(content) as unknown, sourcePath: resolved };
    } catch {
      throw new PrebidConfigInputError('Prebid configuration file contains invalid JSON.');
    }
  }
}

function normalizeGranularity(
  raw: RawPrebidConfig,
  warnings: string[],
): PriceGranularityDefinition {
  const configured = raw.priceGranularity ?? 'medium';
  if (raw.priceGranularity === undefined) {
    warnings.push('priceGranularity was omitted; Prebid default medium is being used.');
  }
  if (typeof configured === 'string') {
    return getStandardGranularity(configured);
  }

  let min = 0;
  const ranges = configured.buckets.map((bucket, index, buckets) => {
    if (bucket.min !== undefined) {
      warnings.push(
        `buckets[${index}].min is preserved as the derived boundary; current Prebid.js derives min from the previous max.`,
      );
    }
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
  return { name: 'custom', ranges };
}

function normalizeCurrency(value: RawPrebidConfig['currency']): string {
  if (typeof value === 'string') return value.toUpperCase();
  return value?.adServerCurrency?.toUpperCase() ?? 'USD';
}

function extractBidderSettingKeys(value: unknown): PrebidTargetingKey[] {
  const standard = asRecord(asRecord(value).standard);
  return asArray(standard.adserverTargeting)
    .map((entry) => asRecord(entry).key)
    .filter(
      (key): key is PrebidTargetingKey =>
        typeof key === 'string' && PREBID_TARGETING_KEYS.includes(key as PrebidTargetingKey),
    );
}

function defaultTargetingKeys(): PrebidTargetingKey[] {
  return ['hb_pb', 'hb_bidder', 'hb_adid', 'hb_size'];
}

function isWithin(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
