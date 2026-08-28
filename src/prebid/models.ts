export const PREBID_TARGETING_KEYS = [
  'hb_pb',
  'hb_bidder',
  'hb_adid',
  'hb_size',
  'hb_format',
  'hb_source',
  'hb_deal',
] as const;

export type PrebidTargetingKey = (typeof PREBID_TARGETING_KEYS)[number];
export type StandardGranularity = 'low' | 'medium' | 'high' | 'auto' | 'dense';
export type GranularityName = StandardGranularity | 'custom';
export type OperationMode = 'GAM_ONLY' | 'GAM_WITH_PREBID';

export type PriceBucketRange = {
  min: number;
  max: number;
  increment: number;
  precision: number;
  cap: boolean;
  rounding: 'FLOOR';
};

export type PriceGranularityDefinition = {
  name: GranularityName;
  ranges: PriceBucketRange[];
};

export type ParsedPrebidConfig = {
  mode: 'GAM_WITH_PREBID';
  granularity: PriceGranularityDefinition;
  currency: string;
  targetingKeys: PrebidTargetingKey[];
  targetingKeysExplicit: boolean;
  universalCreative: {
    enabled: boolean;
    require1x1: boolean;
    expectedSizes: string[];
  };
  warnings: string[];
  source: 'DIRECT' | 'FILE';
  sourcePath?: string;
};

export type GeneratedPriceBuckets = {
  mode: 'GAM_WITH_PREBID';
  granularity: GranularityName;
  currency: string;
  bucketCount: number;
  ranges: PriceBucketRange[];
  min: number;
  max: number;
  cap: number;
  rounding: 'FLOOR';
  values: string[];
};

export type PrebidConfigSource = {
  config?: unknown;
  filePath?: string;
};
