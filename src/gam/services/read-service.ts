import type { AppConfig } from '../../config/env.js';
import type { SecurityPolicy } from '../../security/policy.js';
import type { GamNetwork } from '../models/network.js';
import type {
  AdUnit,
  Creative,
  CustomTargetingKey,
  LineItem,
  LineItemCreativeAssociation,
  ListOptions,
  ListResult,
  Order,
  Placement,
  ReadFilters,
} from '../models/resources.js';
import type { GamReadRepository } from '../repositories/read-repository.js';
import { mapConcurrent } from '../../utils/concurrency.js';

export type GamReadRepositoryProvider = (networkCode: string) => GamReadRepository;

export class GamReadService {
  constructor(
    private readonly config: AppConfig,
    private readonly policy: SecurityPolicy,
    private readonly repositories: GamReadRepositoryProvider,
  ) {}

  getNetwork(networkCode?: string): Promise<GamNetwork> {
    const effectiveNetwork = this.authorizeNetwork(networkCode);
    return this.repositories(effectiveNetwork).getNetwork(effectiveNetwork);
  }

  listOrders(
    networkCode: string | undefined,
    filters: ReadFilters,
    options?: Partial<ListOptions>,
  ) {
    return this.repository(networkCode).listOrders(filters, this.options(options));
  }

  getOrder(networkCode: string | undefined, orderId: string): Promise<Order> {
    return this.repository(networkCode).getOrder(orderId);
  }

  listLineItems(
    networkCode: string | undefined,
    filters: ReadFilters,
    options?: Partial<ListOptions>,
  ): Promise<ListResult<LineItem>> {
    return this.repository(networkCode).listLineItems(filters, this.options(options));
  }

  async listOrderLineItems(
    networkCode: string | undefined,
    orderId: string,
    status: string | undefined,
    options?: Partial<ListOptions>,
  ) {
    const repository = this.repository(networkCode);
    const result = await repository.listLineItems(
      { orderId, ...(status ? { status } : {}) },
      this.options(options),
    );
    const pairs = targetingPairs(result.items);
    const catalogResults = await mapConcurrent(pairs, this.config.gam.auditConcurrency, (pair) =>
      repository
        .getCustomTargeting({ id: pair.keyId, customTargetingValueId: pair.valueId }, { limit: 1 })
        .then(
          (value) => ({ status: 'fulfilled' as const, value }),
          () => ({ status: 'rejected' as const }),
        ),
    );
    const targetingCatalog = mergeTargetingCatalog(
      catalogResults.flatMap((entry) => (entry.status === 'fulfilled' ? entry.value.items : [])),
    );
    const catalogWarnings = catalogResults.flatMap((entry) =>
      entry.status === 'fulfilled' ? entry.value.warnings : [],
    );
    const catalogFailures = catalogResults.filter((entry) => entry.status === 'rejected').length;
    return {
      ...result,
      targetingCatalog,
      warnings: [
        ...result.warnings,
        ...catalogWarnings,
        ...(catalogFailures > 0
          ? [`${catalogFailures} custom targeting key(s) could not be resolved.`]
          : []),
      ],
    };
  }

  getLineItem(networkCode: string | undefined, lineItemId: string): Promise<LineItem> {
    return this.repository(networkCode).getLineItem(lineItemId);
  }

  listCreatives(
    networkCode: string | undefined,
    filters: ReadFilters,
    options?: Partial<ListOptions>,
  ): Promise<ListResult<Creative>> {
    return this.repository(networkCode).listCreatives(filters, this.options(options));
  }

  getCreative(networkCode: string | undefined, creativeId: string): Promise<Creative> {
    return this.repository(networkCode).getCreative(creativeId);
  }

  listAssociations(
    networkCode: string | undefined,
    lineItemIds: string[],
    options?: Partial<ListOptions>,
  ): Promise<ListResult<LineItemCreativeAssociation>> {
    return this.repository(networkCode).listAssociations(lineItemIds, this.options(options));
  }

  listAdUnits(
    networkCode: string | undefined,
    filters: ReadFilters,
    options?: Partial<ListOptions>,
  ): Promise<ListResult<AdUnit>> {
    return this.repository(networkCode).listAdUnits(filters, this.options(options));
  }

  getAdUnit(networkCode: string | undefined, adUnitId: string): Promise<AdUnit> {
    return this.repository(networkCode).getAdUnit(adUnitId);
  }

  listPlacements(
    networkCode: string | undefined,
    filters: ReadFilters,
    options?: Partial<ListOptions>,
  ): Promise<ListResult<Placement>> {
    return this.repository(networkCode).listPlacements(filters, this.options(options));
  }

  getCustomTargeting(
    networkCode: string | undefined,
    filters: ReadFilters,
    options?: Partial<ListOptions>,
  ): Promise<ListResult<CustomTargetingKey>> {
    return this.repository(networkCode).getCustomTargeting(filters, this.options(options));
  }

  auditOptions(): ListOptions {
    return { limit: this.config.gam.auditMaxResources };
  }

  concurrency(): number {
    return this.config.gam.auditConcurrency;
  }

  private repository(networkCode?: string): GamReadRepository {
    return this.repositories(this.authorizeNetwork(networkCode));
  }

  private authorizeNetwork(networkCode?: string): string {
    const effectiveNetwork = networkCode ?? this.config.gam.networkCode;
    this.policy.assertNetworkAllowed(effectiveNetwork);
    return effectiveNetwork;
  }

  private options(options: Partial<ListOptions> = {}): ListOptions {
    const limit = options.limit ?? this.config.gam.defaultListLimit;
    if (limit > this.config.gam.maxListLimit && limit !== this.config.gam.auditMaxResources) {
      throw new Error(
        `Requested limit exceeds GAM_MAX_LIST_LIMIT (${this.config.gam.maxListLimit}).`,
      );
    }
    return { limit, ...(options.pageToken ? { pageToken: options.pageToken } : {}) };
  }
}

function targetingPairs(lineItems: LineItem[]): Array<{ keyId: string; valueId: string }> {
  return [
    ...new Map(
      lineItems.flatMap((item) =>
        item.targeting.customCriteria.flatMap((criterion) =>
          criterion.keyId
            ? criterion.valueIds.map(
                (valueId) =>
                  [
                    `${criterion.keyId}:${valueId}`,
                    { keyId: criterion.keyId as string, valueId },
                  ] as const,
              )
            : [],
        ),
      ),
    ).values(),
  ];
}

function mergeTargetingCatalog(keys: CustomTargetingKey[]): CustomTargetingKey[] {
  const byId = new Map<string, CustomTargetingKey>();
  for (const key of keys) {
    const existing = byId.get(key.id);
    if (!existing) {
      byId.set(key.id, { ...key, values: [...key.values] });
      continue;
    }
    existing.values = [
      ...new Map([...existing.values, ...key.values].map((value) => [value.id, value])).values(),
    ];
  }
  return [...byId.values()];
}
