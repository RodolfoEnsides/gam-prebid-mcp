import type { PriceGranularityDefinition, StandardGranularity } from './models.js';

export type WeightedBidPoint = { cpm: number; count: number };

export type HistoricalBidData = {
  bids?: number[];
  histogram?: WeightedBidPoint[];
  floorPrice?: number;
  currency?: string;
};

export type BidStatistics = {
  sampleSize: number;
  eligibleSampleSize: number;
  excludedBelowFloor: number;
  averageCpm: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  floorPrice: number | null;
  currency: string;
};

export type RoundingLossEstimate = {
  method: 'OBSERVED_WEIGHTED_BIDS';
  currency: string;
  total: number;
  averagePerEligibleBid: number;
  percentageOfEligibleBidValue: number;
  eligibleSampleSize: number;
  cappedBidCount: number;
};

export type GranularityCandidate = {
  name: string;
  currency: string;
  definition: PriceGranularityDefinition;
  lineItems: number;
  estimatedRoundingLoss: RoundingLossEstimate | null;
  lossUnavailableReason?: string;
  operational: {
    exceedsLineItemLimit: boolean;
    estimatedSetupCost: number | null;
    setupCostCurrency?: string;
  };
};

export type PlanningMode = 'standard' | 'dense' | 'auto' | 'custom' | 'recommend';

export type GranularityPlanningRequest = {
  mode: PlanningMode;
  currency: string;
  standardGranularity: Extract<StandardGranularity, 'low' | 'medium' | 'high'>;
  customGranularity?: PriceGranularityDefinition;
  historicalData?: HistoricalBidData;
  maxLineItems?: number;
  maximumAverageRoundingLoss?: number;
  operationalCostPerLineItem?: number;
  operationalCostCurrency?: string;
  minimumHistoricalSamples: number;
};

export type GranularityPlanResult = {
  mode: 'GAM_WITH_PREBID';
  planType: 'PREBID_GRANULARITY';
  planId: string;
  planHash: string;
  requestedMode: PlanningMode;
  status: 'PLANNED' | 'COMPARISON_ONLY';
  selected: GranularityCandidate | null;
  alternatives: GranularityCandidate[];
  statistics: BidStatistics;
  recommendation: {
    idealClaimed: boolean;
    reason: string;
    dataSufficient: boolean;
    minimumHistoricalSamples: number;
  };
  warnings: string[];
};

export type SimulationResult = {
  mode: 'GAM_WITH_PREBID';
  simulationType: 'PREBID_GRANULARITY';
  currency: string;
  statistics: BidStatistics;
  alternatives: Record<string, GranularityCandidate>;
  warnings: string[];
};
