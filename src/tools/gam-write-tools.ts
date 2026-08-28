import type { McpServer } from '@modelcontextprotocol/server';

import type { AppConfig } from '../config/env.js';
import type {
  CreativeAssociationCreate,
  CreativeClone,
  CreativeUpdate,
  LineItemClone,
  LineItemCreate,
  LineItemUpdate,
  OrderCreate,
  OrderUpdate,
  ThirdPartyCreativeCreate,
} from '../gam/models/write-models.js';
import type { BatchOptions, GamWriteService } from '../gam/services/write-service.js';
import type { Logger } from '../logging/logger.js';
import { serializeSafeError } from '../security/safe-error.js';
import {
  associateCreativeInputSchema,
  cloneCreativeInputSchema,
  cloneLineItemInputSchema,
  createCreativeInputSchema,
  createLineItemInputSchema,
  createOrderInputSchema,
  updateCreativeInputSchema,
  updateLineItemInputSchema,
  updateOrderInputSchema,
  type AssociateCreativeInput,
  type CloneCreativeInput,
  type CloneLineItemInput,
  type CreateCreativeInput,
  type CreateLineItemInput,
  type CreateOrderInput,
  type UpdateCreativeInput,
  type UpdateLineItemInput,
  type UpdateOrderInput,
} from './write-schemas.js';

type Dependencies = { config: AppConfig; logger: Logger; write: GamWriteService };

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function registerGamWriteTools(server: McpServer, dependencies: Dependencies): void {
  server.registerTool(
    'gam_create_order',
    {
      description:
        'Creates one or a bounded batch of GAM Orders after idempotency checks. Dry-run defaults to true.',
      inputSchema: createOrderInputSchema,
      annotations: writeAnnotations,
    },
    handler('gam_create_order', dependencies, (input: CreateOrderInput) =>
      dependencies.write.createOrders(
        values<OrderCreate>(input, 'order', 'orders'),
        options(input),
      ),
    ),
  );

  server.registerTool(
    'gam_update_order',
    {
      description:
        'Updates allowlisted Order fields with a before/proposed diff and optional logical rollback.',
      inputSchema: updateOrderInputSchema,
      annotations: writeAnnotations,
    },
    handler('gam_update_order', dependencies, (input: UpdateOrderInput) =>
      dependencies.write.updateOrders(
        values<OrderUpdate>(input, 'update', 'updates'),
        options(input),
      ),
    ),
  );

  server.registerTool(
    'gam_create_line_item',
    {
      description:
        'Creates typed Line Items only inside allowlisted Orders. Dry-run and idempotency checks are mandatory boundaries.',
      inputSchema: createLineItemInputSchema,
      annotations: writeAnnotations,
    },
    handler('gam_create_line_item', dependencies, (input: CreateLineItemInput) =>
      dependencies.write.createLineItems(
        values<LineItemCreate>(input, 'lineItem', 'lineItems'),
        options(input),
      ),
    ),
  );

  server.registerTool(
    'gam_update_line_item',
    {
      description:
        'Updates explicit Line Item fields after resolving and authorizing the owning Order.',
      inputSchema: updateLineItemInputSchema,
      annotations: writeAnnotations,
    },
    handler('gam_update_line_item', dependencies, (input: UpdateLineItemInput) =>
      dependencies.write.updateLineItems(
        values<LineItemUpdate>(input, 'update', 'updates'),
        options(input),
      ),
    ),
  );

  server.registerTool(
    'gam_create_creative',
    {
      description:
        'Creates bounded ThirdPartyCreatives after validating advertiser ownership against an allowlisted Order.',
      inputSchema: createCreativeInputSchema,
      annotations: writeAnnotations,
    },
    handler('gam_create_creative', dependencies, (input: CreateCreativeInput) =>
      dependencies.write.createCreatives(
        values<ThirdPartyCreativeCreate>(input, 'creative', 'creatives'),
        options(input),
      ),
    ),
  );

  server.registerTool(
    'gam_update_creative',
    {
      description:
        'Updates allowlisted ThirdPartyCreative fields with an authorized Order as security context.',
      inputSchema: updateCreativeInputSchema,
      annotations: writeAnnotations,
    },
    handler('gam_update_creative', dependencies, (input: UpdateCreativeInput) =>
      dependencies.write.updateCreatives(
        values<CreativeUpdate>(input, 'update', 'updates'),
        options(input),
      ),
    ),
  );

  server.registerTool(
    'gam_associate_creative',
    {
      description:
        'Creates a non-destructive LineItemCreativeAssociation after Order and advertiser validation.',
      inputSchema: associateCreativeInputSchema,
      annotations: writeAnnotations,
    },
    handler('gam_associate_creative', dependencies, (input: AssociateCreativeInput) =>
      dependencies.write.associateCreatives(
        values<CreativeAssociationCreate>(input, 'association', 'associations'),
        options(input),
      ),
    ),
  );

  server.registerTool(
    'gam_clone_line_item',
    {
      description:
        'Clones a Line Item into an allowlisted Order with only typed overrides and duplicate prevention.',
      inputSchema: cloneLineItemInputSchema,
      annotations: writeAnnotations,
    },
    handler('gam_clone_line_item', dependencies, (input: CloneLineItemInput) =>
      dependencies.write.cloneLineItems(
        values<LineItemClone>(input, 'clone', 'clones'),
        options(input),
      ),
    ),
  );

  server.registerTool(
    'gam_clone_creative',
    {
      description:
        'Clones a ThirdPartyCreative after validating the target Order advertiser and idempotency identity.',
      inputSchema: cloneCreativeInputSchema,
      annotations: writeAnnotations,
    },
    handler('gam_clone_creative', dependencies, (input: CloneCreativeInput) =>
      dependencies.write.cloneCreatives(
        values<CreativeClone>(input, 'clone', 'clones'),
        options(input),
      ),
    ),
  );
}

function values<T>(input: Record<string, unknown>, singular: string, plural: string): T[] {
  const many = input[plural];
  return Array.isArray(many) ? (many as T[]) : [input[singular] as T];
}

function options(input: {
  networkCode?: string | undefined;
  dryRun: boolean;
  continueOnError: boolean;
  rollbackOnFailure: boolean;
}): BatchOptions {
  return {
    ...(input.networkCode ? { networkCode: input.networkCode } : {}),
    dryRun: input.dryRun,
    continueOnError: input.continueOnError,
    rollbackOnFailure: input.rollbackOnFailure,
  };
}

function handler<Input, Output extends { success: boolean }>(
  operation: string,
  dependencies: Dependencies,
  execute: (input: Input) => Promise<Output>,
) {
  return async (input: Input) => {
    try {
      const result = await execute(input);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
        ...(!result.success ? { isError: true } : {}),
      };
    } catch (error) {
      const safe = serializeSafeError(error);
      dependencies.logger.error(`${operation} failed before item execution.`, {
        code: safe.code,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      const result = {
        operation,
        resourceType: 'batch',
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
