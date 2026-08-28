import type { McpServer } from '@modelcontextprotocol/server';

import type { InventoryAuditService } from '../audit/inventory-audit-service.js';
import type { OrderAuditService } from '../audit/order-audit-service.js';
import type { AppConfig } from '../config/env.js';
import type { GamReadService } from '../gam/services/read-service.js';
import type { Logger } from '../logging/logger.js';
import { serializeSafeError } from '../security/safe-error.js';
import { mapConcurrent } from '../utils/concurrency.js';
import {
  adUnitGetInputSchema,
  adUnitListInputSchema,
  auditInventoryInputSchema,
  auditOrderInputSchema,
  creativeGetInputSchema,
  creativeListInputSchema,
  customTargetingInputSchema,
  lineItemCreativesInputSchema,
  lineItemGetInputSchema,
  lineItemListInputSchema,
  networkInputSchema,
  orderGetInputSchema,
  orderLineItemsInputSchema,
  orderListInputSchema,
} from './read-schemas.js';

type Dependencies = {
  config: AppConfig;
  logger: Logger;
  read: GamReadService;
  orderAudit: OrderAuditService;
  inventoryAudit: InventoryAuditService;
};

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function registerGamReadTools(server: McpServer, dependencies: Dependencies): void {
  const { read } = dependencies;

  server.registerTool(
    'gam_get_network',
    {
      description: 'Reads the configured or requested allowed GAM Network.',
      inputSchema: networkInputSchema,
      annotations: readOnlyAnnotations,
    },
    safeHandler('gam_get_network', 'network', dependencies, async ({ networkCode }) => ({
      network: await read.getNetwork(networkCode),
    })),
  );

  server.registerTool(
    'gam_list_orders',
    {
      description: 'Lists GAM Orders with automatic pagination and structured filters.',
      inputSchema: orderListInputSchema,
      annotations: readOnlyAnnotations,
    },
    safeHandler('gam_list_orders', 'order', dependencies, async (input) => {
      const { networkCode, limit, pageToken, ...filters } = input;
      return read.listOrders(networkCode, filters, {
        ...definedLimit(limit),
        ...definedToken(pageToken),
      });
    }),
  );

  server.registerTool(
    'gam_get_order',
    {
      description: 'Reads one GAM Order by ID.',
      inputSchema: orderGetInputSchema,
      annotations: readOnlyAnnotations,
    },
    safeHandler('gam_get_order', 'order', dependencies, async ({ networkCode, orderId }) => ({
      order: await read.getOrder(networkCode, orderId),
    })),
  );

  server.registerTool(
    'gam_list_line_items',
    {
      description:
        'Lists GAM Line Items with filters for order, status, type, dates, targeting, and Ad Unit.',
      inputSchema: lineItemListInputSchema,
      annotations: readOnlyAnnotations,
    },
    safeHandler('gam_list_line_items', 'lineItem', dependencies, async (input) => {
      const { networkCode, limit, pageToken, ...filters } = input;
      return read.listLineItems(networkCode, filters, {
        ...definedLimit(limit),
        ...definedToken(pageToken),
      });
    }),
  );

  server.registerTool(
    'gam_get_line_item',
    {
      description: 'Reads one GAM Line Item by ID.',
      inputSchema: lineItemGetInputSchema,
      annotations: readOnlyAnnotations,
    },
    safeHandler(
      'gam_get_line_item',
      'lineItem',
      dependencies,
      async ({ networkCode, lineItemId }) => ({
        lineItem: await read.getLineItem(networkCode, lineItemId),
      }),
    ),
  );

  server.registerTool(
    'gam_list_order_line_items',
    {
      description: 'Lists Line Items belonging to one GAM Order.',
      inputSchema: orderLineItemsInputSchema,
      annotations: readOnlyAnnotations,
    },
    safeHandler('gam_list_order_line_items', 'lineItem', dependencies, async (input) =>
      read.listLineItems(
        input.networkCode,
        { orderId: input.orderId, ...(input.status ? { status: input.status } : {}) },
        { ...definedLimit(input.limit), ...definedToken(input.pageToken) },
      ),
    ),
  );

  server.registerTool(
    'gam_list_creatives',
    {
      description: 'Lists GAM Creatives through the read-only SOAP adapter.',
      inputSchema: creativeListInputSchema,
      annotations: readOnlyAnnotations,
    },
    safeHandler('gam_list_creatives', 'creative', dependencies, async (input) => {
      const { networkCode, limit, pageToken, ...filters } = input;
      return read.listCreatives(networkCode, filters, {
        ...definedLimit(limit),
        ...definedToken(pageToken),
      });
    }),
  );

  server.registerTool(
    'gam_get_creative',
    {
      description: 'Reads one GAM Creative by ID through SOAP.',
      inputSchema: creativeGetInputSchema,
      annotations: readOnlyAnnotations,
    },
    safeHandler(
      'gam_get_creative',
      'creative',
      dependencies,
      async ({ networkCode, creativeId }) => ({
        creative: await read.getCreative(networkCode, creativeId),
      }),
    ),
  );

  server.registerTool(
    'gam_list_line_item_creatives',
    {
      description: 'Lists LICA associations and their Creative details for one Line Item.',
      inputSchema: lineItemCreativesInputSchema,
      annotations: readOnlyAnnotations,
    },
    safeHandler(
      'gam_list_line_item_creatives',
      'lineItemCreativeAssociation',
      dependencies,
      async (input) => {
        const associations = await read.listAssociations(input.networkCode, [input.lineItemId], {
          ...definedLimit(input.limit),
          ...definedToken(input.pageToken),
        });
        const creatives = await mapConcurrent(
          [...new Set(associations.items.map((association) => association.creativeId))],
          read.concurrency(),
          (creativeId) => read.getCreative(input.networkCode, creativeId),
        );
        return {
          summary: { associations: associations.count, creatives: creatives.length },
          associations,
          creatives,
        };
      },
    ),
  );

  server.registerTool(
    'gam_list_ad_units',
    {
      description: 'Lists GAM Ad Units with automatic pagination.',
      inputSchema: adUnitListInputSchema,
      annotations: readOnlyAnnotations,
    },
    safeHandler('gam_list_ad_units', 'adUnit', dependencies, async (input) => {
      const { networkCode, limit, pageToken, ...filters } = input;
      return read.listAdUnits(networkCode, filters, {
        ...definedLimit(limit),
        ...definedToken(pageToken),
      });
    }),
  );

  server.registerTool(
    'gam_get_ad_unit',
    {
      description: 'Reads one GAM Ad Unit by ID.',
      inputSchema: adUnitGetInputSchema,
      annotations: readOnlyAnnotations,
    },
    safeHandler('gam_get_ad_unit', 'adUnit', dependencies, async ({ networkCode, adUnitId }) => ({
      adUnit: await read.getAdUnit(networkCode, adUnitId),
    })),
  );

  server.registerTool(
    'gam_get_custom_targeting',
    {
      description: 'Reads Custom Targeting keys and their values.',
      inputSchema: customTargetingInputSchema,
      annotations: readOnlyAnnotations,
    },
    safeHandler('gam_get_custom_targeting', 'customTargeting', dependencies, async (input) =>
      read.getCustomTargeting(
        input.networkCode,
        {
          ...(input.keyId ? { id: input.keyId } : {}),
          ...(input.keyName ? { name: input.keyName } : {}),
          ...(input.valueId ? { customTargetingValueId: input.valueId } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
        { ...definedLimit(input.limit), ...definedToken(input.pageToken) },
      ),
    ),
  );

  server.registerTool(
    'gam_audit_order',
    {
      description:
        'Performs a read-only configuration audit of one Order and its related resources.',
      inputSchema: auditOrderInputSchema,
      annotations: readOnlyAnnotations,
    },
    safeHandler('gam_audit_order', 'orderAudit', dependencies, ({ networkCode, orderId }) =>
      dependencies.orderAudit.execute(networkCode, orderId),
    ),
  );

  server.registerTool(
    'gam_audit_inventory',
    {
      description: 'Audits Ad Units, Placements, targeting coverage, and related Line Items.',
      inputSchema: auditInventoryInputSchema,
      annotations: readOnlyAnnotations,
    },
    safeHandler('gam_audit_inventory', 'inventoryAudit', dependencies, ({ networkCode }) =>
      dependencies.inventoryAudit.execute(networkCode),
    ),
  );
}

function safeHandler<Input, Output extends object>(
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

function definedLimit(limit?: number): { limit?: number } {
  return limit === undefined ? {} : { limit };
}

function definedToken(pageToken?: string): { pageToken?: string } {
  return pageToken === undefined ? {} : { pageToken };
}
