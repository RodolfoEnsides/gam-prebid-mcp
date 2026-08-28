import { McpServer } from '@modelcontextprotocol/server';

import type { AppConfig } from '../config/env.js';
import type { GamConnectionTestService } from '../gam/services/connection-test-service.js';
import type { GamReadService } from '../gam/services/read-service.js';
import type { GamWriteService } from '../gam/services/write-service.js';
import type { InventoryAuditService } from '../audit/inventory-audit-service.js';
import type { OrderAuditService } from '../audit/order-audit-service.js';
import type { Logger } from '../logging/logger.js';
import type { PrebidAuditService } from '../prebid/audit-service.js';
import type { GamGranularityPlanService } from '../prebid/gam-granularity-plan-service.js';
import type { GranularityPlanningService } from '../prebid/granularity-planning-service.js';
import type { PrebidService } from '../prebid/service.js';
import {
  createGamConnectionTestHandler,
  gamConnectionTestInputSchema,
} from '../tools/gam-connection-test.js';
import { registerGamReadTools } from '../tools/gam-read-tools.js';
import { registerPrebidTools } from '../tools/prebid-tools.js';
import { registerGranularityPlanningTools } from '../tools/granularity-planning-tools.js';
import { registerGamWriteTools } from '../tools/gam-write-tools.js';
import type { GranularityApplicationService } from '../prebid/granularity-application-service.js';
import { registerGranularityApplicationTools } from '../tools/granularity-application-tools.js';

export type ServerDependencies = {
  config: AppConfig;
  logger: Logger;
  connectionTestService: GamConnectionTestService;
  readService: GamReadService;
  orderAuditService: OrderAuditService;
  inventoryAuditService: InventoryAuditService;
  prebidService: PrebidService;
  prebidAuditService: PrebidAuditService;
  granularityPlanningService: GranularityPlanningService;
  gamGranularityPlanService: GamGranularityPlanService;
  writeService: GamWriteService;
  granularityApplicationService: GranularityApplicationService;
};

export function createMcpServer(dependencies: ServerDependencies): McpServer {
  const server = new McpServer(
    { name: 'gam-prebid-mcp', version: '0.6.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'Safety-first GAM and Prebid server. GAM-only reads remain independent. Granularity automation requires separate persisted PLAN, explicit DRY RUN, VALIDATE/seal, APPLY, and POST AUDIT calls. Typed writes require per-call dryRun=false, global write mode, and resource allowlists. No delete, archive, force-apply, or generic mutation tool is registered.',
    },
  );

  server.registerTool(
    'gam_connection_test',
    {
      title: 'Test Google Ad Manager connection',
      description:
        'Authenticates, validates an allowed Network Code, and verifies read access without changing GAM data.',
      inputSchema: gamConnectionTestInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    createGamConnectionTestHandler(
      dependencies.connectionTestService,
      dependencies.config,
      dependencies.logger,
    ),
  );

  registerGamReadTools(server, {
    config: dependencies.config,
    logger: dependencies.logger,
    read: dependencies.readService,
    orderAudit: dependencies.orderAuditService,
    inventoryAudit: dependencies.inventoryAuditService,
  });

  registerPrebidTools(server, {
    config: dependencies.config,
    logger: dependencies.logger,
    prebid: dependencies.prebidService,
    audit: dependencies.prebidAuditService,
  });

  registerGranularityPlanningTools(server, {
    config: dependencies.config,
    logger: dependencies.logger,
    prebid: dependencies.prebidService,
    planning: dependencies.granularityPlanningService,
    gamPlanning: dependencies.gamGranularityPlanService,
  });

  registerGamWriteTools(server, {
    config: dependencies.config,
    logger: dependencies.logger,
    write: dependencies.writeService,
  });

  registerGranularityApplicationTools(server, {
    config: dependencies.config,
    logger: dependencies.logger,
    prebid: dependencies.prebidService,
    application: dependencies.granularityApplicationService,
  });

  return server;
}
