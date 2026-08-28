import { describe, expect, it } from 'vitest';

import { GranularityPlanningService } from '../../src/prebid/granularity-planning-service.js';
import { PriceBucketEngine } from '../../src/prebid/price-bucket-engine.js';

describe('GranularityPlanningService', () => {
  const service = new GranularityPlanningService(new PriceBucketEngine(100_000));

  it('compares alternatives without inventing an ideal choice or revenue loss', () => {
    const result = service.plan({
      mode: 'recommend',
      currency: 'USD',
      standardGranularity: 'medium',
      minimumHistoricalSamples: 100,
    });

    expect(result.status).toBe('COMPARISON_ONLY');
    expect(result.selected).toBeNull();
    expect(result.recommendation.idealClaimed).toBe(false);
    expect(result.recommendation.reason).toContain('insufficient');
    expect(result.alternatives.map((item) => item.lineItems)).toEqual([201, 171, 425]);
    expect(result.alternatives.every((item) => item.estimatedRoundingLoss === null)).toBe(true);
    expect(result.planHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('uses weighted bids, percentiles, floor, loss, and an operational limit to recommend', () => {
    const result = service.plan({
      mode: 'recommend',
      currency: 'USD',
      standardGranularity: 'medium',
      historicalData: {
        histogram: [
          { cpm: 0.25, count: 20 },
          { cpm: 1.09, count: 200 },
          { cpm: 4.99, count: 20 },
        ],
        floorPrice: 1,
        currency: 'USD',
      },
      maxLineItems: 250,
      operationalCostPerLineItem: 2,
      operationalCostCurrency: 'USD',
      minimumHistoricalSamples: 100,
    });

    expect(result.status).toBe('PLANNED');
    expect(result.selected?.name).toBe('auto');
    expect(result.recommendation.idealClaimed).toBe(true);
    expect(result.statistics).toMatchObject({
      sampleSize: 240,
      eligibleSampleSize: 220,
      excludedBelowFloor: 20,
      p50: 1.09,
      p95: 4.99,
      floorPrice: 1,
    });
    expect(result.selected?.estimatedRoundingLoss?.averagePerEligibleBid).toBeGreaterThan(0);
    expect(result.selected?.operational.estimatedSetupCost).toBe(342);
  });

  it('does not estimate across currencies or call explicit modes ideal', () => {
    const result = service.plan({
      mode: 'dense',
      currency: 'BRL',
      standardGranularity: 'medium',
      historicalData: { bids: [1.23, 2.34], currency: 'USD' },
      minimumHistoricalSamples: 1,
    });

    expect(result.selected?.name).toBe('dense');
    expect(result.selected?.estimatedRoundingLoss).toBeNull();
    expect(result.selected?.lossUnavailableReason).toContain('currency differs');
    expect(result.recommendation.idealClaimed).toBe(false);
  });

  it('simulates configured alternatives without historical loss values', () => {
    const result = service.simulate({
      currency: 'USD',
      alternatives: [
        { name: 'medium', definition: service.standardDefinition('medium') },
        { name: 'dense', definition: service.standardDefinition('dense') },
      ],
    });

    expect(result.alternatives.medium?.lineItems).toBe(201);
    expect(result.alternatives.dense?.lineItems).toBe(425);
    expect(result.alternatives.medium?.estimatedRoundingLoss).toBeNull();
    expect(result.warnings[0]).toContain('unavailable');
  });

  it('generates a stable identifier for identical plans', () => {
    const request = {
      mode: 'standard' as const,
      currency: 'USD',
      standardGranularity: 'medium' as const,
      minimumHistoricalSamples: 100,
    };
    expect(service.plan(request).planHash).toBe(service.plan(request).planHash);
  });
});
