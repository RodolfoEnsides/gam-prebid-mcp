import type { McpServer } from '@modelcontextprotocol/server';

import type { AppConfig } from '../config/env.js';
import type { GranularityApplicationService } from '../prebid/granularity-application-service.js';
import type { PrebidService } from '../prebid/service.js';
import type { Logger } from '../logging/logger.js';
import { serializeSafeError } from '../security/safe-error.js';
import {
  applyGranularityPlanInputSchema,
  createGranularityPlanInputSchema,
  postApplyAuditInputSchema,
  validateGranularityPlanInputSchema,
  type ApplyGranularityPlanInput,
  type CreateGranularityPlanInput,
  type PostApplyAuditInput,
  type ValidateGranularityPlanInput,
} from './granularity-application-schemas.js';
import { planningRequest } from './granularity-planning-tools.js';

type Dependencies = {
  config: AppConfig;
  logger: Logger;
  prebid: PrebidService;
  application: GranularityApplicationService;
};

const controlAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function registerGranularityApplicationTools(
  server: McpServer,
  dependencies: Dependencies,
): void {
  server.registerTool(
    'prebid_create_granularity_plan',
    {
      description:
        'Audits an allowlisted GAM Order and persists a non-executing Prebid plan. It never writes to GAM and cannot apply in the same call.',
      inputSchema: createGranularityPlanInputSchema,
      annotations: controlAnnotations,
    },
    handler(
      'prebid_create_granularity_plan',
      dependencies,
      async (input: CreateGranularityPlanInput) =>
        dependencies.application.create({
          ...(input.networkCode ? { networkCode: input.networkCode } : {}),
          orderId: input.orderId,
          planning: await planningRequest(input, dependencies.prebid),
          lineItemTemplate: { ...input.lineItemTemplate, costType: 'CPM' },
          ...(input.baseLineItemId ? { baseLineItemId: input.baseLineItemId } : {}),
          creativeStrategy: input.creativeStrategy,
        }),
    ),
  );

  server.registerTool(
    'prebid_validate_granularity_plan',
    {
      description:
        'Requires a completed dry-run, re-audits GAM for drift, and seals the plan immutably when validation succeeds.',
      inputSchema: validateGranularityPlanInputSchema,
      annotations: controlAnnotations,
    },
    handler(
      'prebid_validate_granularity_plan',
      dependencies,
      (input: ValidateGranularityPlanInput) => dependencies.application.validate(input.planId),
    ),
  );

  server.registerTool(
    'prebid_apply_granularity_plan',
    {
      description:
        'Requires an explicit dryRun boolean. true simulates and records the diff; false only applies an already validated immutable plan in resumable batches after drift checks.',
      inputSchema: applyGranularityPlanInputSchema,
      annotations: controlAnnotations,
    },
    handler('prebid_apply_granularity_plan', dependencies, (input: ApplyGranularityPlanInput) =>
      dependencies.application.apply(input.planId, input.dryRun),
    ),
  );

  server.registerTool(
    'prebid_post_apply_audit',
    {
      description:
        'Re-audits an applied plan and proves bucket, targeting, CPM, duplicate, and creative outcomes without further GAM mutation.',
      inputSchema: postApplyAuditInputSchema,
      annotations: controlAnnotations,
    },
    handler('prebid_post_apply_audit', dependencies, (input: PostApplyAuditInput) =>
      dependencies.application.postAudit(input.planId),
    ),
  );
}

function handler<Input, Output>(
  operation: string,
  dependencies: Pick<Dependencies, 'logger'>,
  execute: (input: Input) => Promise<Output>,
) {
  return async (input: Input) => {
    try {
      const result = await execute(input);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (error) {
      const safe = serializeSafeError(error);
      dependencies.logger.error(`${operation} failed safely.`, {
        code: safe.code,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      const result = {
        operation,
        resourceType: 'granularityPlan',
        dryRun:
          input && typeof input === 'object' && 'dryRun' in input
            ? (input as { dryRun?: unknown }).dryRun !== false
            : true,
        changed: false,
        warnings: [],
        errors: [`${safe.code}: ${safe.message}`],
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result,
        isError: true,
      };
    }
  };
}
