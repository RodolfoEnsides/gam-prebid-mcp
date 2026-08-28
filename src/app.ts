import type { AppConfig } from './config/env.js';
import { WriteAuditLogger } from './audit/write-audit-logger.js';
import { InventoryAuditService } from './audit/inventory-audit-service.js';
import { OrderAuditService } from './audit/order-audit-service.js';
import { GamRestAdapter } from './gam/adapters/gam-rest-adapter.js';
import { GamSoapAdapter } from './gam/adapters/gam-soap-adapter.js';
import { GoogleGamAuthProvider } from './gam/auth/google-auth-provider.js';
import { FetchHttpClient } from './gam/clients/http-client.js';
import { DefaultNetworkRepository } from './gam/repositories/network-repository.js';
import { DefaultGamReadRepository } from './gam/repositories/read-repository.js';
import { DefaultGamWriteRepository } from './gam/repositories/write-repository.js';
import { GamConnectionTestService } from './gam/services/connection-test-service.js';
import { GamReadService } from './gam/services/read-service.js';
import { GamWriteService } from './gam/services/write-service.js';
import type { Logger } from './logging/logger.js';
import { createMcpServer } from './mcp/server.js';
import { PrebidAuditService } from './prebid/audit-service.js';
import { PrebidConfigLoader } from './prebid/config-loader.js';
import { GamGranularityPlanService } from './prebid/gam-granularity-plan-service.js';
import { GranularityPlanningService } from './prebid/granularity-planning-service.js';
import { PriceBucketEngine } from './prebid/price-bucket-engine.js';
import { PrebidService } from './prebid/service.js';
import { SecurityPolicy } from './security/policy.js';
import { GranularityPlanStore } from './prebid/plan-store.js';
import { GranularityApplicationService } from './prebid/granularity-application-service.js';

export function buildApplication(config: AppConfig, logger: Logger) {
  const auth = new GoogleGamAuthProvider(config);
  const http = new FetchHttpClient();
  const restAdapter = new GamRestAdapter(auth, http, logger, {
    timeoutMs: config.gam.requestTimeoutMs,
    maxRetries: config.gam.maxRetries,
  });
  const networks = new DefaultNetworkRepository(restAdapter);
  const policy = new SecurityPolicy(config.gam);
  const connectionTestService = new GamConnectionTestService(config, policy, auth, networks);
  const soapAdapterCache = new Map<string, GamSoapAdapter>();
  const soapAdapterProvider = (networkCode: string) => {
    const existing = soapAdapterCache.get(networkCode);
    if (existing) return existing;
    const adapter = new GamSoapAdapter(auth, http, logger, {
      networkCode,
      apiVersion: config.gam.soapApiVersion,
      applicationName: config.gam.applicationName,
      timeoutMs: config.gam.requestTimeoutMs,
      maxRetries: config.gam.maxRetries,
      pageSize: config.gam.pageSize,
    });
    soapAdapterCache.set(networkCode, adapter);
    return adapter;
  };
  const repositoryCache = new Map<string, DefaultGamReadRepository>();
  const repositoryProvider = (networkCode: string) => {
    const existing = repositoryCache.get(networkCode);
    if (existing) return existing;
    const repository = new DefaultGamReadRepository(
      networkCode,
      config.gam.pageSize,
      config.gam.auditConcurrency,
      restAdapter,
      soapAdapterProvider(networkCode),
    );
    repositoryCache.set(networkCode, repository);
    return repository;
  };
  const readService = new GamReadService(config, policy, repositoryProvider);
  const writeRepositoryCache = new Map<string, DefaultGamWriteRepository>();
  const writeRepositoryProvider = (networkCode: string) => {
    const existing = writeRepositoryCache.get(networkCode);
    if (existing) return existing;
    const repository = new DefaultGamWriteRepository(soapAdapterProvider(networkCode));
    writeRepositoryCache.set(networkCode, repository);
    return repository;
  };
  const writeService = new GamWriteService(
    config,
    policy,
    writeRepositoryProvider,
    new WriteAuditLogger(logger),
  );
  const orderAuditService = new OrderAuditService(readService);
  const inventoryAuditService = new InventoryAuditService(readService);
  const prebidLoader = new PrebidConfigLoader(config.prebid);
  const priceBucketEngine = new PriceBucketEngine(config.prebid.maxBuckets);
  const prebidService = new PrebidService(prebidLoader, priceBucketEngine);
  const prebidAuditService = new PrebidAuditService(orderAuditService, priceBucketEngine);
  const granularityPlanningService = new GranularityPlanningService(priceBucketEngine);
  const gamGranularityPlanService = new GamGranularityPlanService(
    orderAuditService,
    priceBucketEngine,
  );
  const granularityApplicationService = new GranularityApplicationService(
    config,
    policy,
    orderAuditService,
    granularityPlanningService,
    gamGranularityPlanService,
    prebidAuditService,
    writeService,
    new GranularityPlanStore(config.gam.planStoreDirectory),
  );

  return createMcpServer({
    config,
    logger,
    connectionTestService,
    readService,
    orderAuditService,
    inventoryAuditService,
    prebidService,
    prebidAuditService,
    granularityPlanningService,
    gamGranularityPlanService,
    writeService,
    granularityApplicationService,
  });
}
