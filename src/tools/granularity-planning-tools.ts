import type { McpServer } from '@modelcontextprotocol/server';

import type { AppConfig } from '../config/env.js';
import type { Logger } from '../logging/logger.js';
import type { GamGranularityPlanService } from '../prebid/gam-granularity-plan-service.js';
import type { GranularityPlanningRequest, HistoricalBidData } from '../prebid/planning-models.js';
import type { GranularityPlanningService } from '../prebid/granularity-planning-service.js';
import type { PrebidService } from '../prebid/service.js';
import { serializeSafeError } from '../security/safe-error.js';
import {
  gamPlanPrebidGranularityInputSchema,
  prebidPlanGranularityInputSchema,
  prebidSimulateGranularityInputSchema,
  type GamPlanPrebidGranularityInput,
  type PrebidPlanGranularityInput,
  type PrebidSimulateGranularityInput,
} from './granularity-planning-schemas.js';

type Dependencies = {
  config: AppConfig;
  logger: Logger;
  prebid: PrebidService;
  planning: GranularityPlanningService;
  gamPlanning: GamGranularityPlanService;
};

const planningAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerGranularityPlanningTools(
  server: McpServer,
  dependencies: Dependencies,
): void {
  server.registerTool(
    'prebid_plan_granularity',
    {
      description:
        'Builds a traceable Prebid granularity plan or an explicit comparison when an ideal choice cannot be supported.',
      inputSchema: prebidPlanGranularityInputSchema,
      annotations: planningAnnotations,
    },
    safeHandler('prebid_plan_granularity', 'granularityPlan', dependencies, async (input) =>
      dependencies.planning.plan(await planningRequest(input, dependencies.prebid)),
    ),
  );

  server.registerTool(
    'prebid_simulate_granularity',
    {
      description:
        'Compares Line Item counts and observed rounding loss across standard and custom granularities.',
      inputSchema: prebidSimulateGranularityInputSchema,
      annotations: planningAnnotations,
    },
    safeHandler('prebid_simulate_granularity', 'granularitySimulation', dependencies, (input) =>
      simulate(input, dependencies),
    ),
  );

  server.registerTool(
    'gam_plan_prebid_granularity',
    {
      description:
        'Reads a GAM Order and produces a hashed, non-executing plan of Line Items, targeting, creatives, associations, preserved items, and conflicts.',
      inputSchema: gamPlanPrebidGranularityInputSchema,
      annotations: { ...planningAnnotations, openWorldHint: true },
    },
    safeHandler(
      'gam_plan_prebid_granularity',
      'gamGranularityPlan',
      dependencies,
      async (input) => {
        const plan = dependencies.planning.plan(await planningRequest(input, dependencies.prebid));
        return dependencies.gamPlanning.plan(input.networkCode, input.orderId, plan, {
          ...input.lineItemTemplate,
          costType: 'CPM',
        });
      },
    ),
  );
}

export async function planningRequest(
  input: PrebidPlanGranularityInput | GamPlanPrebidGranularityInput,
  prebid: PrebidService,
): Promise<GranularityPlanningRequest> {
  const customGranularity = input.customGranularity
    ? (await prebid.parse({ config: { priceGranularity: input.customGranularity } })).granularity
    : undefined;
  return {
    mode: input.mode,
    currency: input.currency,
    standardGranularity: input.standardGranularity,
    minimumHistoricalSamples: input.minimumHistoricalSamples,
    ...(customGranularity ? { customGranularity } : {}),
    ...(input.historicalData ? { historicalData: historical(input.historicalData) } : {}),
    ...(input.maxLineItems !== undefined ? { maxLineItems: input.maxLineItems } : {}),
    ...(input.maximumAverageRoundingLoss !== undefined
      ? { maximumAverageRoundingLoss: input.maximumAverageRoundingLoss }
      : {}),
    ...(input.operationalCostPerLineItem !== undefined
      ? { operationalCostPerLineItem: input.operationalCostPerLineItem }
      : {}),
    ...(input.operationalCostCurrency
      ? { operationalCostCurrency: input.operationalCostCurrency }
      : {}),
  };
}

async function simulate(input: PrebidSimulateGranularityInput, dependencies: Dependencies) {
  const standard = input.alternatives.map((name) => ({
    name,
    definition: dependencies.planning.standardDefinition(name),
  }));
  const custom = await Promise.all(
    input.customAlternatives.map(async (alternative) => ({
      name: alternative.name,
      definition: (
        await dependencies.prebid.parse({
          config: { priceGranularity: alternative.granularity },
        })
      ).granularity,
    })),
  );
  return dependencies.planning.simulate({
    currency: input.currency,
    alternatives: [...standard, ...custom],
    ...(input.historicalData ? { historicalData: historical(input.historicalData) } : {}),
    ...(input.maxLineItems !== undefined ? { maxLineItems: input.maxLineItems } : {}),
    ...(input.operationalCostPerLineItem !== undefined
      ? { operationalCostPerLineItem: input.operationalCostPerLineItem }
      : {}),
    ...(input.operationalCostCurrency
      ? { operationalCostCurrency: input.operationalCostCurrency }
      : {}),
  });
}

function historical(
  value: NonNullable<PrebidPlanGranularityInput['historicalData']>,
): HistoricalBidData {
  return {
    ...(value.bids ? { bids: value.bids } : {}),
    ...(value.histogram ? { histogram: value.histogram } : {}),
    ...(value.floorPrice !== undefined ? { floorPrice: value.floorPrice } : {}),
    ...(value.currency ? { currency: value.currency } : {}),
  };
}

function safeHandler<Input, Output>(
  operation: string,
  resourceType: string,
  dependencies: Pick<Dependencies, 'config' | 'logger'>,
  handler: (input: Input) => Promise<Output>,
) {
  return async (input: Input) => {
    try {
      const result = await handler(input);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (error) {
      const safeError = serializeSafeError(error);
      dependencies.logger.error(`${operation} failed.`, {
        code: safeError.code,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      const result = {
        operation,
        resourceType,
        dryRun: true,
        changed: false,
        warnings: [],
        errors: [`${safeError.code}: ${safeError.message}`],
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result,
        isError: true,
      };
    }
  };
}
