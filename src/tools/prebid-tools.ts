import type { McpServer } from '@modelcontextprotocol/server';

import type { AppConfig } from '../config/env.js';
import type { Logger } from '../logging/logger.js';
import type { PrebidAuditService } from '../prebid/audit-service.js';
import type { PrebidService } from '../prebid/service.js';
import { serializeSafeError } from '../security/safe-error.js';
import {
  prebidOrderInputSchema,
  prebidSourceInputSchema,
  type PrebidOrderInput,
  type PrebidSourceInput,
} from './prebid-schemas.js';

type Dependencies = {
  config: AppConfig;
  logger: Logger;
  prebid: PrebidService;
  audit: PrebidAuditService;
};

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerPrebidTools(server: McpServer, dependencies: Dependencies): void {
  server.registerTool(
    'prebid_parse_config',
    {
      description:
        'Validates and normalizes a direct or allowlisted JSON Prebid configuration without contacting GAM.',
      inputSchema: prebidSourceInputSchema,
      annotations: readOnlyAnnotations,
    },
    safeHandler('prebid_parse_config', 'prebidConfig', dependencies, (input) =>
      dependencies.prebid.parse(source(input)),
    ),
  );

  server.registerTool(
    'prebid_generate_price_buckets',
    {
      description:
        'Generates exact hb_pb values for low, medium, high, auto, dense, or custom granularity.',
      inputSchema: prebidSourceInputSchema,
      annotations: readOnlyAnnotations,
    },
    safeHandler('prebid_generate_price_buckets', 'priceBuckets', dependencies, (input) =>
      dependencies.prebid.generate(source(input)),
    ),
  );

  server.registerTool(
    'prebid_analyze_granularity',
    {
      description:
        'Summarizes ranges, precision, cap, currency, and bucket count for a Prebid granularity.',
      inputSchema: prebidSourceInputSchema,
      annotations: readOnlyAnnotations,
    },
    safeHandler('prebid_analyze_granularity', 'priceGranularity', dependencies, (input) =>
      dependencies.prebid.analyze(source(input)),
    ),
  );

  server.registerTool(
    'prebid_compare_gam',
    {
      description:
        'Read-only comparison of expected Prebid buckets, targeting, CPMs, and creatives with a GAM Order.',
      inputSchema: prebidOrderInputSchema,
      annotations: { ...readOnlyAnnotations, openWorldHint: true },
    },
    safeHandler('prebid_compare_gam', 'prebidGamComparison', dependencies, async (input) => {
      const config = await dependencies.prebid.parse(source(input));
      return dependencies.audit.compare(auditRequest(input, config));
    }),
  );

  server.registerTool(
    'prebid_audit_order',
    {
      description:
        'Combines the complete GAM Order audit with a read-only Prebid comparison in one execution.',
      inputSchema: prebidOrderInputSchema,
      annotations: { ...readOnlyAnnotations, openWorldHint: true },
    },
    safeHandler('prebid_audit_order', 'prebidOrderAudit', dependencies, async (input) => {
      const config = await dependencies.prebid.parse(source(input));
      return dependencies.audit.audit(auditRequest(input, config));
    }),
  );

  server.registerTool(
    'prebid_validate_targeting',
    {
      description:
        'Validates hb_pb and explicitly configured Prebid targeting keys on a GAM Order.',
      inputSchema: prebidOrderInputSchema,
      annotations: { ...readOnlyAnnotations, openWorldHint: true },
    },
    safeHandler(
      'prebid_validate_targeting',
      'prebidTargetingAudit',
      dependencies,
      async (input) => {
        const config = await dependencies.prebid.parse(source(input));
        return dependencies.audit.validateTargeting(auditRequest(input, config));
      },
    ),
  );
}

function source(input: PrebidSourceInput): { config?: unknown; filePath?: string } {
  return {
    ...(input.config !== undefined ? { config: input.config } : {}),
    ...(input.filePath !== undefined ? { filePath: input.filePath } : {}),
  };
}

function auditRequest(
  input: PrebidOrderInput,
  config: Awaited<ReturnType<PrebidService['parse']>>,
) {
  return {
    ...(input.networkCode ? { networkCode: input.networkCode } : {}),
    orderId: input.orderId,
    simultaneousAdUnits: input.simultaneousAdUnits,
    config,
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
      const structuredContent = result as Record<string, unknown>;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent,
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
        dryRun: dependencies.config.gam.dryRun,
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
