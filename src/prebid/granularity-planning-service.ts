import type {
  GranularityCandidate,
  GranularityPlanResult,
  GranularityPlanningRequest,
  HistoricalBidData,
  SimulationResult,
} from './planning-models.js';
import type { PriceGranularityDefinition, StandardGranularity } from './models.js';
import { identifyPlan } from './plan-hash.js';
import type { PriceBucketEngine } from './price-bucket-engine.js';
import { getStandardGranularity } from './presets.js';
import { calculateBidStatistics, estimateRoundingLoss } from './statistics.js';

export type SimulationRequest = {
  currency: string;
  alternatives: Array<{ name: string; definition: PriceGranularityDefinition }>;
  historicalData?: HistoricalBidData;
  maxLineItems?: number;
  operationalCostPerLineItem?: number;
  operationalCostCurrency?: string;
};

export class GranularityPlanningService {
  constructor(private readonly engine: PriceBucketEngine) {}

  plan(request: GranularityPlanningRequest): GranularityPlanResult {
    const candidateDefinitions = this.candidates(request);
    const alternatives = candidateDefinitions.map(({ name, definition }) =>
      this.evaluateCandidate(name, definition, request),
    );
    const statistics = calculateBidStatistics(request.historicalData, request.currency);
    const dataSufficient = statistics.eligibleSampleSize >= request.minimumHistoricalSamples;
    const { selected, reason, idealClaimed } = selectCandidate(
      request,
      alternatives,
      dataSufficient,
    );
    const warnings = planningWarnings(
      request,
      statistics.eligibleSampleSize,
      dataSufficient,
      selected,
    );
    const body = {
      mode: 'GAM_WITH_PREBID' as const,
      planType: 'PREBID_GRANULARITY' as const,
      requestedMode: request.mode,
      status: selected ? ('PLANNED' as const) : ('COMPARISON_ONLY' as const),
      selected,
      alternatives,
      statistics,
      recommendation: {
        idealClaimed,
        reason,
        dataSufficient,
        minimumHistoricalSamples: request.minimumHistoricalSamples,
      },
      warnings,
    };
    return { ...identifyPlan('prebid-granularity', body), ...body };
  }

  simulate(request: SimulationRequest): SimulationResult {
    const statistics = calculateBidStatistics(request.historicalData, request.currency);
    const alternatives = Object.fromEntries(
      request.alternatives.map(({ name, definition }) => [
        name,
        this.evaluateCandidate(name, definition, {
          currency: request.currency,
          ...(request.historicalData ? { historicalData: request.historicalData } : {}),
          ...(request.maxLineItems !== undefined ? { maxLineItems: request.maxLineItems } : {}),
          ...(request.operationalCostPerLineItem !== undefined
            ? { operationalCostPerLineItem: request.operationalCostPerLineItem }
            : {}),
          ...(request.operationalCostCurrency
            ? { operationalCostCurrency: request.operationalCostCurrency }
            : {}),
        }),
      ]),
    );
    return {
      mode: 'GAM_WITH_PREBID',
      simulationType: 'PREBID_GRANULARITY',
      currency: request.currency,
      statistics,
      alternatives,
      warnings:
        statistics.sampleSize === 0
          ? ['Rounding loss is unavailable because no historical bid observations were provided.']
          : [],
    };
  }

  standardDefinition(name: StandardGranularity): PriceGranularityDefinition {
    return getStandardGranularity(name);
  }

  private candidates(
    request: GranularityPlanningRequest,
  ): Array<{ name: string; definition: PriceGranularityDefinition }> {
    switch (request.mode) {
      case 'standard':
        return [
          {
            name: request.standardGranularity,
            definition: getStandardGranularity(request.standardGranularity),
          },
        ];
      case 'dense':
        return [{ name: 'dense', definition: getStandardGranularity('dense') }];
      case 'auto':
        return [{ name: 'auto', definition: getStandardGranularity('auto') }];
      case 'custom':
        return request.customGranularity
          ? [{ name: 'custom', definition: request.customGranularity }]
          : [];
      case 'recommend':
        return [
          { name: 'medium', definition: getStandardGranularity('medium') },
          { name: 'auto', definition: getStandardGranularity('auto') },
          { name: 'dense', definition: getStandardGranularity('dense') },
          ...(request.customGranularity
            ? [{ name: 'custom', definition: request.customGranularity }]
            : []),
        ];
    }
  }

  private evaluateCandidate(
    name: string,
    definition: PriceGranularityDefinition,
    request: Pick<
      GranularityPlanningRequest,
      | 'currency'
      | 'historicalData'
      | 'maxLineItems'
      | 'operationalCostPerLineItem'
      | 'operationalCostCurrency'
    >,
  ): GranularityCandidate {
    const parsed = {
      mode: 'GAM_WITH_PREBID' as const,
      granularity: definition,
      currency: request.currency,
      targetingKeys: ['hb_pb' as const],
      targetingKeysExplicit: true,
      universalCreative: { enabled: true, require1x1: false, expectedSizes: [] },
      warnings: [],
      source: 'DIRECT' as const,
    };
    const lineItems = this.engine.generate(parsed).bucketCount;
    const currencyCompatible =
      !request.historicalData?.currency || request.historicalData.currency === request.currency;
    const loss = currencyCompatible
      ? estimateRoundingLoss(request.historicalData, definition, request.currency, this.engine)
      : null;
    return {
      name,
      currency: request.currency,
      definition,
      lineItems,
      estimatedRoundingLoss: loss,
      ...(loss
        ? {}
        : {
            lossUnavailableReason: currencyCompatible
              ? 'Historical bid observations eligible after the floor price were not provided.'
              : 'Historical bid currency differs from the planning currency; no conversion was assumed.',
          }),
      operational: {
        exceedsLineItemLimit:
          request.maxLineItems !== undefined && lineItems > request.maxLineItems,
        estimatedSetupCost:
          request.operationalCostPerLineItem !== undefined
            ? Number((lineItems * request.operationalCostPerLineItem).toFixed(8))
            : null,
        ...(request.operationalCostPerLineItem !== undefined
          ? { setupCostCurrency: request.operationalCostCurrency ?? request.currency }
          : {}),
      },
    };
  }
}

function selectCandidate(
  request: GranularityPlanningRequest,
  alternatives: GranularityCandidate[],
  dataSufficient: boolean,
): { selected: GranularityCandidate | null; reason: string; idealClaimed: boolean } {
  if (request.mode !== 'recommend') {
    const selected = alternatives[0] ?? null;
    return {
      selected,
      reason: selected
        ? 'The explicitly requested granularity was planned; it is not presented as statistically ideal.'
        : 'The requested custom granularity was not provided.',
      idealClaimed: false,
    };
  }
  if (!dataSufficient) {
    return {
      selected: null,
      reason:
        'Historical data is insufficient to claim an ideal granularity. Alternatives are provided for comparison only.',
      idealClaimed: false,
    };
  }
  if (request.maxLineItems === undefined && request.maximumAverageRoundingLoss === undefined) {
    return {
      selected: null,
      reason:
        'Historical data is available, but no operational Line Item limit or acceptable average rounding loss was provided.',
      idealClaimed: false,
    };
  }
  const eligible = alternatives.filter((candidate) => {
    const averageLoss = candidate.estimatedRoundingLoss?.averagePerEligibleBid;
    return (
      !candidate.operational.exceedsLineItemLimit &&
      averageLoss !== undefined &&
      (request.maximumAverageRoundingLoss === undefined ||
        averageLoss <= request.maximumAverageRoundingLoss)
    );
  });
  if (eligible.length === 0) {
    return {
      selected: null,
      reason: 'No candidate satisfies the provided operational and rounding-loss constraints.',
      idealClaimed: false,
    };
  }
  const selected = [...eligible].sort((left, right) => {
    if (request.maximumAverageRoundingLoss !== undefined) return left.lineItems - right.lineItems;
    return (
      (left.estimatedRoundingLoss?.averagePerEligibleBid ?? Infinity) -
        (right.estimatedRoundingLoss?.averagePerEligibleBid ?? Infinity) ||
      left.lineItems - right.lineItems
    );
  })[0];
  return {
    selected: selected ?? null,
    reason: selected
      ? 'Selected from observed bids using the supplied operational and loss constraints.'
      : 'No candidate could be selected.',
    idealClaimed: selected !== undefined,
  };
}

function planningWarnings(
  request: GranularityPlanningRequest,
  eligibleSampleSize: number,
  dataSufficient: boolean,
  selected: GranularityCandidate | null,
): string[] {
  const warnings: string[] = [];
  if (request.mode === 'recommend' && !dataSufficient) {
    warnings.push(
      `Only ${eligibleSampleSize} historical bid observation(s) eligible after the floor were provided; ${request.minimumHistoricalSamples} are required for recommendation.`,
    );
  } else if (eligibleSampleSize === 0) {
    warnings.push('No historical bids were provided; rounding loss was not estimated.');
  }
  if (request.historicalData?.currency && request.historicalData.currency !== request.currency) {
    warnings.push('Historical bid currency differs from the requested planning currency.');
  }
  if (!selected) warnings.push('No actionable granularity was selected.');
  if (selected?.operational.exceedsLineItemLimit) {
    warnings.push('The explicitly selected granularity exceeds the supplied Line Item limit.');
  }
  return warnings;
}
