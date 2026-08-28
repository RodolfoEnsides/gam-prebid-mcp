import type { GamRestAdapter } from '../adapters/gam-rest-adapter.js';
import type { GamSoapAdapter } from '../adapters/gam-soap-adapter.js';
import { GamApiError } from '../adapters/errors.js';
import { mapConcurrent } from '../../utils/concurrency.js';
import {
  normalizeAdUnit,
  normalizeAssociation,
  normalizeCreative,
  normalizeCustomTargetingKey,
  normalizeCustomTargetingValue,
  normalizeLineItem,
  normalizeOrder,
  normalizePlacement,
} from '../models/normalize.js';
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
import type { GamNetwork } from '../models/network.js';

export interface GamReadRepository {
  getNetwork(networkCode: string): Promise<GamNetwork>;
  listOrders(filters: ReadFilters, options: ListOptions): Promise<ListResult<Order>>;
  getOrder(orderId: string): Promise<Order>;
  listLineItems(filters: ReadFilters, options: ListOptions): Promise<ListResult<LineItem>>;
  getLineItem(lineItemId: string): Promise<LineItem>;
  listCreatives(filters: ReadFilters, options: ListOptions): Promise<ListResult<Creative>>;
  getCreative(creativeId: string): Promise<Creative>;
  listAssociations(
    lineItemIds: string[],
    options: ListOptions,
  ): Promise<ListResult<LineItemCreativeAssociation>>;
  listAdUnits(filters: ReadFilters, options: ListOptions): Promise<ListResult<AdUnit>>;
  getAdUnit(adUnitId: string): Promise<AdUnit>;
  listPlacements(filters: ReadFilters, options: ListOptions): Promise<ListResult<Placement>>;
  getCustomTargeting(
    filters: ReadFilters,
    options: ListOptions,
  ): Promise<ListResult<CustomTargetingKey>>;
}

export class DefaultGamReadRepository implements GamReadRepository {
  constructor(
    private readonly networkCode: string,
    private readonly pageSize: number,
    private readonly concurrency: number,
    private readonly rest: GamRestAdapter,
    private readonly soap: GamSoapAdapter,
  ) {}

  getNetwork(networkCode: string): Promise<GamNetwork> {
    return this.rest.getNetwork(networkCode);
  }

  listOrders(filters: ReadFilters, options: ListOptions): Promise<ListResult<Order>> {
    return this.rest.list({
      path: this.networkPath('orders'),
      collection: 'orders',
      normalize: normalizeOrder,
      limit: options.limit,
      pageSize: this.pageSize,
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      ...(buildRestFilter('order', filters, this.networkCode)
        ? { filter: buildRestFilter('order', filters, this.networkCode) }
        : {}),
      orderBy: 'displayName',
    });
  }

  getOrder(orderId: string): Promise<Order> {
    return this.rest.get(
      `${this.networkPath('orders')}/${encodeURIComponent(orderId)}`,
      normalizeOrder,
    );
  }

  async listLineItems(filters: ReadFilters, options: ListOptions): Promise<ListResult<LineItem>> {
    const result = await this.rest.list({
      path: this.networkPath('lineItems'),
      collection: 'lineItems',
      normalize: normalizeLineItem,
      limit: options.limit,
      pageSize: this.pageSize,
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      ...(buildRestFilter('lineItem', filters, this.networkCode)
        ? { filter: buildRestFilter('lineItem', filters, this.networkCode) }
        : {}),
      orderBy: 'displayName',
    });
    const locallyFiltered = result.items.filter((item) =>
      matchesLocalLineItemFilters(item, filters),
    );
    return { ...result, items: locallyFiltered, count: locallyFiltered.length };
  }

  getLineItem(lineItemId: string): Promise<LineItem> {
    return this.rest.get(
      `${this.networkPath('lineItems')}/${encodeURIComponent(lineItemId)}`,
      normalizeLineItem,
    );
  }

  async listCreatives(filters: ReadFilters, options: ListOptions): Promise<ListResult<Creative>> {
    const result = await this.soap.listByStatement({
      service: 'CreativeService',
      method: 'getCreativesByStatement',
      ...(buildSoapCreativeWhere(filters) ? { where: buildSoapCreativeWhere(filters) } : {}),
      limit: options.limit,
      ...(options.pageToken ? { offset: parseOffset(options.pageToken) } : {}),
    });
    return { ...result, items: result.items.map((item) => normalizeCreative(item)) };
  }

  async getCreative(creativeId: string): Promise<Creative> {
    const result = await this.listCreatives({ id: creativeId }, { limit: 1 });
    const creative = result.items[0];
    if (!creative) throw new GamApiError('Creative was not found.', 404);
    return creative;
  }

  async listAssociations(
    lineItemIds: string[],
    options: ListOptions,
  ): Promise<ListResult<LineItemCreativeAssociation>> {
    if (lineItemIds.length === 0) {
      return { items: [], count: 0, limit: options.limit, truncated: false, warnings: [] };
    }
    const where = `lineItemId IN (${lineItemIds.map(soapNumber).join(',')})`;
    const result = await this.soap.listByStatement({
      service: 'LineItemCreativeAssociationService',
      method: 'getLineItemCreativeAssociationsByStatement',
      where,
      limit: options.limit,
      ...(options.pageToken ? { offset: parseOffset(options.pageToken) } : {}),
    });
    return { ...result, items: result.items.map(normalizeAssociation) };
  }

  listAdUnits(filters: ReadFilters, options: ListOptions): Promise<ListResult<AdUnit>> {
    return this.rest.list({
      path: this.networkPath('adUnits'),
      collection: 'adUnits',
      normalize: normalizeAdUnit,
      limit: options.limit,
      pageSize: this.pageSize,
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      ...(buildRestFilter('adUnit', filters, this.networkCode)
        ? { filter: buildRestFilter('adUnit', filters, this.networkCode) }
        : {}),
      orderBy: 'displayName',
    });
  }

  getAdUnit(adUnitId: string): Promise<AdUnit> {
    return this.rest.get(
      `${this.networkPath('adUnits')}/${encodeURIComponent(adUnitId)}`,
      normalizeAdUnit,
    );
  }

  listPlacements(filters: ReadFilters, options: ListOptions): Promise<ListResult<Placement>> {
    return this.rest.list({
      path: this.networkPath('placements'),
      collection: 'placements',
      normalize: normalizePlacement,
      limit: options.limit,
      pageSize: this.pageSize,
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      ...(buildRestFilter('placement', filters, this.networkCode)
        ? { filter: buildRestFilter('placement', filters, this.networkCode) }
        : {}),
      orderBy: 'displayName',
    });
  }

  async getCustomTargeting(
    filters: ReadFilters,
    options: ListOptions,
  ): Promise<ListResult<CustomTargetingKey>> {
    const keys = await this.rest.list({
      path: this.networkPath('customTargetingKeys'),
      collection: 'customTargetingKeys',
      normalize: normalizeCustomTargetingKey,
      limit: options.limit,
      pageSize: this.pageSize,
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      ...(buildRestFilter('customTargetingKey', filters, this.networkCode)
        ? { filter: buildRestFilter('customTargetingKey', filters, this.networkCode) }
        : {}),
      orderBy: 'displayName',
    });
    const enriched = await mapConcurrent(keys.items, this.concurrency, async (key) => {
      const values = await this.rest.list({
        path: `${this.networkPath('customTargetingKeys')}/${encodeURIComponent(key.id)}/customTargetingValues`,
        collection: 'customTargetingValues',
        normalize: normalizeCustomTargetingValue,
        limit: options.limit,
        pageSize: this.pageSize,
        ...(filters.customTargetingValueId
          ? {
              filter: `name = ${quoteFilter(`networks/${this.networkCode}/customTargetingKeys/${key.id}/customTargetingValues/${filters.customTargetingValueId}`)}`,
            }
          : {}),
      });
      key.values = values.items;
      return { key, warnings: values.warnings };
    });
    keys.items = enriched.map((item) => item.key);
    keys.warnings.push(...enriched.flatMap((item) => item.warnings));
    return keys;
  }

  private networkPath(resource: string): string {
    return `/networks/${encodeURIComponent(this.networkCode)}/${resource}`;
  }
}

function buildRestFilter(
  resource: 'order' | 'lineItem' | 'adUnit' | 'placement' | 'customTargetingKey',
  filters: ReadFilters,
  networkCode: string,
): string | undefined {
  const clauses: string[] = [];
  if (filters.id)
    clauses.push(
      `name = ${quoteFilter(`networks/${networkCode}/${restPlural(resource)}/${filters.id}`)}`,
    );
  if (filters.name) clauses.push(`displayName : ${quoteFilter(filters.name)}`);
  if (filters.status) clauses.push(`status = ${filters.status}`);
  if (resource === 'order' && filters.advertiserId) {
    clauses.push(
      `advertiser = ${quoteFilter(`networks/${networkCode}/companies/${filters.advertiserId}`)}`,
    );
  }
  if (resource === 'order') {
    if (filters.startDate)
      clauses.push(`startTime >= ${quoteFilter(asStartTimestamp(filters.startDate))}`);
    if (filters.endDate) clauses.push(`endTime <= ${quoteFilter(asEndTimestamp(filters.endDate))}`);
  }
  if (resource === 'lineItem') {
    if (filters.orderId)
      clauses.push(`order = ${quoteFilter(`networks/${networkCode}/orders/${filters.orderId}`)}`);
    if (filters.lineItemType) clauses.push(`lineItemType = ${filters.lineItemType}`);
    if (filters.startDate)
      clauses.push(`startTime >= ${quoteFilter(asStartTimestamp(filters.startDate))}`);
    if (filters.endDate) clauses.push(`endTime <= ${quoteFilter(asEndTimestamp(filters.endDate))}`);
    if (filters.adUnitId) {
      clauses.push(
        `targeting.inventoryTargeting.targetedAdUnits.adUnit = ${quoteFilter(`networks/${networkCode}/adUnits/${filters.adUnitId}`)}`,
      );
    }
  }
  return clauses.length > 0 ? clauses.join(' AND ') : undefined;
}

function restPlural(resource: string): string {
  return resource === 'customTargetingKey' ? 'customTargetingKeys' : `${resource}s`;
}

function quoteFilter(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function asStartTimestamp(value: string): string {
  return value.includes('T') ? value : `${value}T00:00:00Z`;
}

function asEndTimestamp(value: string): string {
  return value.includes('T') ? value : `${value}T23:59:59Z`;
}

function buildSoapCreativeWhere(filters: ReadFilters): string | undefined {
  const clauses: string[] = [];
  if (filters.id) clauses.push(`id = ${soapNumber(filters.id)}`);
  if (filters.name) clauses.push(`name LIKE ${soapString(`%${filters.name}%`)}`);
  if (filters.advertiserId) clauses.push(`advertiserId = ${soapNumber(filters.advertiserId)}`);
  if (filters.status) clauses.push(`status = ${soapString(filters.status)}`);
  return clauses.length > 0 ? clauses.join(' AND ') : undefined;
}

function soapNumber(value: string): string {
  if (!/^\d+$/.test(value)) throw new Error('SOAP numeric filter must contain only digits.');
  return value;
}

function soapString(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function parseOffset(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error('Invalid SOAP page token.');
  return Number(value);
}

function matchesLocalLineItemFilters(item: LineItem, filters: ReadFilters): boolean {
  if (
    filters.customTargetingKeyId &&
    !item.targeting.customCriteria.some(
      (criterion) => criterion.keyId === filters.customTargetingKeyId,
    )
  ) {
    return false;
  }
  if (
    filters.customTargetingValueId &&
    !item.targeting.customCriteria.some((criterion) =>
      criterion.valueIds.includes(filters.customTargetingValueId as string),
    )
  ) {
    return false;
  }
  return true;
}
