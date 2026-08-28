import type {
  BidStatistics,
  HistoricalBidData,
  RoundingLossEstimate,
  WeightedBidPoint,
} from './planning-models.js';
import type { PriceGranularityDefinition } from './models.js';
import type { PriceBucketEngine } from './price-bucket-engine.js';

export function normalizeBidPoints(data: HistoricalBidData | undefined): WeightedBidPoint[] {
  if (!data) return [];
  const combined = new Map<number, number>();
  for (const cpm of data.bids ?? []) combined.set(cpm, (combined.get(cpm) ?? 0) + 1);
  for (const point of data.histogram ?? []) {
    combined.set(point.cpm, (combined.get(point.cpm) ?? 0) + point.count);
  }
  return [...combined.entries()]
    .map(([cpm, count]) => ({ cpm, count }))
    .sort((left, right) => left.cpm - right.cpm);
}

export function calculateBidStatistics(
  data: HistoricalBidData | undefined,
  currency: string,
): BidStatistics {
  const points = normalizeBidPoints(data);
  const sampleSize = count(points);
  const floorPrice = data?.floorPrice ?? null;
  const eligible = points.filter((point) => floorPrice === null || point.cpm >= floorPrice);
  const eligibleSampleSize = count(eligible);
  const total = eligible.reduce((sum, point) => sum + point.cpm * point.count, 0);
  return {
    sampleSize,
    eligibleSampleSize,
    excludedBelowFloor: sampleSize - eligibleSampleSize,
    averageCpm: eligibleSampleSize > 0 ? round(total / eligibleSampleSize) : null,
    p50: quantile(eligible, 0.5),
    p75: quantile(eligible, 0.75),
    p90: quantile(eligible, 0.9),
    p95: quantile(eligible, 0.95),
    p99: quantile(eligible, 0.99),
    floorPrice,
    currency: data?.currency ?? currency,
  };
}

export function estimateRoundingLoss(
  data: HistoricalBidData | undefined,
  definition: PriceGranularityDefinition,
  currency: string,
  engine: PriceBucketEngine,
): RoundingLossEstimate | null {
  const points = normalizeBidPoints(data);
  if (points.length === 0) return null;
  const floorPrice = data?.floorPrice;
  const eligible = points.filter((point) => floorPrice === undefined || point.cpm >= floorPrice);
  const eligibleSampleSize = count(eligible);
  if (eligibleSampleSize === 0) return null;
  const cap = Math.max(...definition.ranges.map((range) => range.max));
  let loss = 0;
  let bidValue = 0;
  let cappedBidCount = 0;
  for (const point of eligible) {
    const bucket = Number(engine.bucketCpm(point.cpm, definition));
    loss += Math.max(0, point.cpm - bucket) * point.count;
    bidValue += point.cpm * point.count;
    if (point.cpm > cap) cappedBidCount += point.count;
  }
  return {
    method: 'OBSERVED_WEIGHTED_BIDS',
    currency: data?.currency ?? currency,
    total: round(loss),
    averagePerEligibleBid: round(loss / eligibleSampleSize),
    percentageOfEligibleBidValue: bidValue > 0 ? round((loss / bidValue) * 100) : 0,
    eligibleSampleSize,
    cappedBidCount,
  };
}

function quantile(points: WeightedBidPoint[], percentile: number): number | null {
  const total = count(points);
  if (total === 0) return null;
  const rank = Math.max(1, Math.ceil(total * percentile));
  let cumulative = 0;
  for (const point of points) {
    cumulative += point.count;
    if (cumulative >= rank) return round(point.cpm);
  }
  return round(points.at(-1)?.cpm ?? 0);
}

function count(points: WeightedBidPoint[]): number {
  return points.reduce((sum, point) => sum + point.count, 0);
}

function round(value: number): number {
  return Number(value.toFixed(8));
}
