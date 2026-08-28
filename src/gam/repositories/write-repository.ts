import type { GamSoapAdapter } from '../adapters/gam-soap-adapter.js';
import { GamApiError } from '../adapters/errors.js';
import {
  normalizeAssociation,
  normalizeCreative,
  normalizeLineItem,
  normalizeOrder,
} from '../models/normalize.js';
import type {
  Creative,
  LineItem,
  LineItemCreativeAssociation,
  Order,
  Size,
  TargetingSummary,
} from '../models/resources.js';
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
} from '../models/write-models.js';

export type ResourceSnapshot<T> = { resource: T; raw: Record<string, unknown> };

export interface GamWriteRepository {
  findOrder(input: OrderCreate): Promise<ResourceSnapshot<Order> | undefined>;
  getOrder(orderId: string): Promise<ResourceSnapshot<Order>>;
  createOrder(input: OrderCreate): Promise<Order>;
  updateOrder(snapshot: ResourceSnapshot<Order>, update: OrderUpdate): Promise<Order>;

  findLineItem(input: LineItemCreate): Promise<ResourceSnapshot<LineItem> | undefined>;
  getLineItem(lineItemId: string): Promise<ResourceSnapshot<LineItem>>;
  createLineItem(input: LineItemCreate): Promise<LineItem>;
  updateLineItem(snapshot: ResourceSnapshot<LineItem>, update: LineItemUpdate): Promise<LineItem>;
  cloneLineItem(snapshot: ResourceSnapshot<LineItem>, input: LineItemClone): Promise<LineItem>;

  findCreative(input: ThirdPartyCreativeCreate): Promise<ResourceSnapshot<Creative> | undefined>;
  getCreative(creativeId: string): Promise<ResourceSnapshot<Creative>>;
  createCreative(input: ThirdPartyCreativeCreate): Promise<Creative>;
  updateCreative(snapshot: ResourceSnapshot<Creative>, update: CreativeUpdate): Promise<Creative>;
  cloneCreative(snapshot: ResourceSnapshot<Creative>, input: CreativeClone): Promise<Creative>;

  findAssociation(
    input: CreativeAssociationCreate,
  ): Promise<LineItemCreativeAssociation | undefined>;
  createAssociation(input: CreativeAssociationCreate): Promise<LineItemCreativeAssociation>;
}

export class DefaultGamWriteRepository implements GamWriteRepository {
  constructor(private readonly soap: GamSoapAdapter) {}

  findOrder(input: OrderCreate): Promise<ResourceSnapshot<Order> | undefined> {
    const where = input.externalOrderId
      ? `externalOrderId = ${soapNumber(input.externalOrderId)}`
      : `name = ${soapString(input.name)} AND advertiserId = ${soapNumber(input.advertiserId)}`;
    return this.findOne('OrderService', 'getOrdersByStatement', where, normalizeOrder);
  }

  getOrder(orderId: string): Promise<ResourceSnapshot<Order>> {
    return this.requireOne(
      'OrderService',
      'getOrdersByStatement',
      `id = ${soapNumber(orderId)}`,
      normalizeOrder,
      'Order',
    );
  }

  async createOrder(input: OrderCreate): Promise<Order> {
    const result = await this.soap.mutate({
      service: 'OrderService',
      method: 'createOrders',
      parameter: 'orders',
      values: [orderPayload(input)],
      retrySafe: false,
    });
    return normalizeOrder(requireResult(result, 'Order'));
  }

  async updateOrder(snapshot: ResourceSnapshot<Order>, update: OrderUpdate): Promise<Order> {
    const payload = mergeWritable(
      snapshot.raw,
      orderPatch(update.patch),
      ['id'],
      orderReadOnlyFields,
    );
    const result = await this.soap.mutate({
      service: 'OrderService',
      method: 'updateOrders',
      parameter: 'orders',
      values: [payload],
      retrySafe: true,
    });
    return normalizeOrder(requireResult(result, 'Order'));
  }

  findLineItem(input: LineItemCreate): Promise<ResourceSnapshot<LineItem> | undefined> {
    const where = input.externalId
      ? `externalId = ${soapString(input.externalId)}`
      : `orderId = ${soapNumber(input.orderId)} AND name = ${soapString(input.name)}`;
    return this.findOne('LineItemService', 'getLineItemsByStatement', where, normalizeLineItem);
  }

  getLineItem(lineItemId: string): Promise<ResourceSnapshot<LineItem>> {
    return this.requireOne(
      'LineItemService',
      'getLineItemsByStatement',
      `id = ${soapNumber(lineItemId)}`,
      normalizeLineItem,
      'Line Item',
    );
  }

  async createLineItem(input: LineItemCreate): Promise<LineItem> {
    const result = await this.soap.mutate({
      service: 'LineItemService',
      method: 'createLineItems',
      parameter: 'lineItems',
      values: [lineItemPayload(input)],
      retrySafe: false,
    });
    return normalizeLineItem(requireResult(result, 'Line Item'));
  }

  async updateLineItem(
    snapshot: ResourceSnapshot<LineItem>,
    update: LineItemUpdate,
  ): Promise<LineItem> {
    const payload = mergeWritable(
      snapshot.raw,
      lineItemPatch(update.patch),
      ['id', 'orderId'],
      lineItemReadOnlyFields,
    );
    const result = await this.soap.mutate({
      service: 'LineItemService',
      method: 'updateLineItems',
      parameter: 'lineItems',
      values: [payload],
      retrySafe: true,
    });
    return normalizeLineItem(requireResult(result, 'Line Item'));
  }

  async cloneLineItem(
    snapshot: ResourceSnapshot<LineItem>,
    input: LineItemClone,
  ): Promise<LineItem> {
    const payload = mergeWritable(
      clonePayload(snapshot.raw, lineItemReadOnlyFields),
      {
        orderId: input.targetOrderId,
        name: input.name,
        ...(input.externalId ? { externalId: input.externalId } : {}),
        ...lineItemPatch(input.overrides ?? {}),
      },
      [],
    );
    const result = await this.soap.mutate({
      service: 'LineItemService',
      method: 'createLineItems',
      parameter: 'lineItems',
      values: [payload],
      retrySafe: false,
    });
    return normalizeLineItem(requireResult(result, 'Line Item'));
  }

  findCreative(input: ThirdPartyCreativeCreate): Promise<ResourceSnapshot<Creative> | undefined> {
    const where = input.externalId
      ? `externalId = ${soapString(input.externalId)}`
      : `advertiserId = ${soapNumber(input.advertiserId)} AND name = ${soapString(input.name)}`;
    return this.findOne(
      'CreativeService',
      'getCreativesByStatement',
      where,
      normalizeCreativeWrite,
    );
  }

  getCreative(creativeId: string): Promise<ResourceSnapshot<Creative>> {
    return this.requireOne(
      'CreativeService',
      'getCreativesByStatement',
      `id = ${soapNumber(creativeId)}`,
      normalizeCreativeWrite,
      'Creative',
    );
  }

  async createCreative(input: ThirdPartyCreativeCreate): Promise<Creative> {
    const result = await this.soap.mutate({
      service: 'CreativeService',
      method: 'createCreatives',
      parameter: 'creatives',
      values: [creativePayload(input)],
      retrySafe: false,
    });
    return normalizeCreativeWrite(requireResult(result, 'Creative'));
  }

  async updateCreative(
    snapshot: ResourceSnapshot<Creative>,
    update: CreativeUpdate,
  ): Promise<Creative> {
    const payload = mergeWritable(
      snapshot.raw,
      creativePatch(update.patch),
      ['id', 'advertiserId'],
      creativeReadOnlyFields,
    );
    const result = await this.soap.mutate({
      service: 'CreativeService',
      method: 'updateCreatives',
      parameter: 'creatives',
      values: [payload],
      retrySafe: true,
    });
    return normalizeCreativeWrite(requireResult(result, 'Creative'));
  }

  async cloneCreative(
    snapshot: ResourceSnapshot<Creative>,
    input: CreativeClone,
  ): Promise<Creative> {
    const payload = mergeWritable(
      clonePayload(snapshot.raw, creativeReadOnlyFields),
      {
        name: input.name,
        ...(input.externalId ? { externalId: input.externalId } : {}),
        ...creativePatch(input.overrides ?? {}),
      },
      [],
    );
    const result = await this.soap.mutate({
      service: 'CreativeService',
      method: 'createCreatives',
      parameter: 'creatives',
      values: [payload],
      retrySafe: false,
    });
    return normalizeCreativeWrite(requireResult(result, 'Creative'));
  }

  async findAssociation(
    input: CreativeAssociationCreate,
  ): Promise<LineItemCreativeAssociation | undefined> {
    const result = await this.soap.listByStatement({
      service: 'LineItemCreativeAssociationService',
      method: 'getLineItemCreativeAssociationsByStatement',
      where: `lineItemId = ${soapNumber(input.lineItemId)} AND creativeId = ${soapNumber(input.creativeId)}`,
      limit: 1,
    });
    const raw = result.items[0];
    return raw ? normalizeAssociation(raw) : undefined;
  }

  async createAssociation(input: CreativeAssociationCreate): Promise<LineItemCreativeAssociation> {
    const result = await this.soap.mutate({
      service: 'LineItemCreativeAssociationService',
      method: 'createLineItemCreativeAssociations',
      parameter: 'lineItemCreativeAssociations',
      values: [
        {
          lineItemId: input.lineItemId,
          creativeId: input.creativeId,
          ...(input.sizes ? { sizes: input.sizes.map(sizePayload) } : {}),
        },
      ],
      retrySafe: false,
    });
    return normalizeAssociation(requireResult(result, 'Creative association'));
  }

  private async findOne<T>(
    service: 'OrderService' | 'LineItemService' | 'CreativeService',
    method: 'getOrdersByStatement' | 'getLineItemsByStatement' | 'getCreativesByStatement',
    where: string,
    normalize: (value: unknown) => T,
  ): Promise<ResourceSnapshot<T> | undefined> {
    const result = await this.soap.listByStatement({ service, method, where, limit: 2 });
    if (result.items.length > 1) {
      throw new GamApiError('Idempotency lookup returned more than one resource.', 409);
    }
    const raw = result.items[0];
    return raw && typeof raw === 'object'
      ? { resource: normalize(raw), raw: raw as Record<string, unknown> }
      : undefined;
  }

  private async requireOne<T>(
    service: 'OrderService' | 'LineItemService' | 'CreativeService',
    method: 'getOrdersByStatement' | 'getLineItemsByStatement' | 'getCreativesByStatement',
    where: string,
    normalize: (value: unknown) => T,
    resourceType: string,
  ): Promise<ResourceSnapshot<T>> {
    const result = await this.findOne(service, method, where, normalize);
    if (!result) throw new GamApiError(`${resourceType} was not found.`, 404);
    return result;
  }
}

const orderReadOnlyFields = [
  'id',
  'status',
  'isArchived',
  'creatorId',
  'currencyCode',
  'lastModifiedDateTime',
  'lastModifiedByApp',
];

const lineItemReadOnlyFields = [
  'id',
  'status',
  'isArchived',
  'creationDateTime',
  'lastModifiedDateTime',
  'stats',
  'deliveryData',
  'budget',
];

const creativeReadOnlyFields = [
  'id',
  'status',
  'creationDateTime',
  'lastModifiedDateTime',
  'previewUrl',
  'policyLabels',
];

function orderPayload(input: OrderCreate): Record<string, unknown> {
  return {
    name: input.name,
    advertiserId: input.advertiserId,
    traffickerId: input.traffickerId,
    ...(input.salespersonId ? { salespersonId: input.salespersonId } : {}),
    ...(input.externalOrderId ? { externalOrderId: input.externalOrderId } : {}),
    ...(input.poNumber ? { poNumber: input.poNumber } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  };
}

function orderPatch(patch: OrderUpdate['patch']): Record<string, unknown> {
  return { ...patch };
}

function lineItemPayload(input: LineItemCreate): Record<string, unknown> {
  return {
    orderId: input.orderId,
    name: input.name,
    lineItemType: input.lineItemType,
    priority: input.priority,
    costType: input.costType,
    costPerUnit: moneyPayload(input.costPerUnit),
    startDateTime: dateTimePayload(input.startTime),
    ...(input.endTime ? { endDateTime: dateTimePayload(input.endTime) } : {}),
    unlimitedEndDateTime: input.unlimitedEndTime,
    creativePlaceholders: input.creativePlaceholderSizes.map((size) => ({
      size: sizePayload(size),
    })),
    targeting: targetingPayload(input.targeting),
    primaryGoal: input.primaryGoal,
    ...(input.externalId ? { externalId: input.externalId } : {}),
  };
}

function lineItemPatch(patch: LineItemUpdate['patch']): Record<string, unknown> {
  return {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.lineItemType !== undefined ? { lineItemType: patch.lineItemType } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.costType !== undefined ? { costType: patch.costType } : {}),
    ...(patch.costPerUnit !== undefined ? { costPerUnit: moneyPayload(patch.costPerUnit) } : {}),
    ...(patch.startTime !== undefined ? { startDateTime: dateTimePayload(patch.startTime) } : {}),
    ...(patch.endTime !== undefined ? { endDateTime: dateTimePayload(patch.endTime) } : {}),
    ...(patch.unlimitedEndTime !== undefined
      ? { unlimitedEndDateTime: patch.unlimitedEndTime }
      : {}),
    ...(patch.creativePlaceholderSizes !== undefined
      ? {
          creativePlaceholders: patch.creativePlaceholderSizes.map((size) => ({
            size: sizePayload(size),
          })),
        }
      : {}),
    ...(patch.targeting !== undefined ? { targeting: targetingPayload(patch.targeting) } : {}),
    ...(patch.primaryGoal !== undefined ? { primaryGoal: patch.primaryGoal } : {}),
    ...(patch.externalId !== undefined ? { externalId: patch.externalId } : {}),
  };
}

function creativePayload(input: ThirdPartyCreativeCreate): Record<string, unknown> {
  return {
    __type: 'ThirdPartyCreative',
    advertiserId: input.advertiserId,
    name: input.name,
    size: sizePayload(input.size),
    snippet: input.snippet,
    isSafeFrameCompatible: input.isSafeFrameCompatible,
    ...(input.externalId ? { externalId: input.externalId } : {}),
  };
}

function creativePatch(patch: CreativeUpdate['patch']): Record<string, unknown> {
  return {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.size !== undefined ? { size: sizePayload(patch.size) } : {}),
    ...(patch.snippet !== undefined ? { snippet: patch.snippet } : {}),
    ...(patch.isSafeFrameCompatible !== undefined
      ? { isSafeFrameCompatible: patch.isSafeFrameCompatible }
      : {}),
    ...(patch.externalId !== undefined ? { externalId: patch.externalId } : {}),
  };
}

function moneyPayload(value: { currencyCode: string; micros: string }) {
  return { currencyCode: value.currencyCode, microAmount: value.micros };
}

function sizePayload(size: Size) {
  if (size.width === undefined || size.height === undefined) {
    throw new Error('Creative sizes must have numeric width and height.');
  }
  return { width: size.width, height: size.height, isAspectRatio: false };
}

function targetingPayload(targeting: TargetingSummary): Record<string, unknown> {
  return {
    inventoryTargeting: {
      targetedAdUnits: targeting.adUnitIds.map((adUnitId) => ({
        adUnitId,
        includeDescendants: true,
      })),
      excludedAdUnits: targeting.excludedAdUnitIds.map((adUnitId) => ({
        adUnitId,
        includeDescendants: true,
      })),
      targetedPlacementIds: targeting.placementIds,
    },
    ...(targeting.customCriteria.length > 0
      ? {
          customTargeting: {
            __type: 'CustomCriteriaSet',
            logicalOperator: 'AND',
            children: targeting.customCriteria.map((criterion) => ({
              __type: 'CustomCriteria',
              keyId: criterion.keyId,
              valueIds: criterion.valueIds,
              operator: criterion.operator ?? 'IS',
            })),
          },
        }
      : {}),
  };
}

function dateTimePayload(value: string): Record<string, unknown> {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid ISO datetime.');
  return {
    date: {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    },
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    timeZoneId: 'UTC',
  };
}

function mergeWritable(
  raw: Record<string, unknown>,
  patch: Record<string, unknown>,
  requiredFields: string[],
  fieldsToRemove: string[] = [],
): Record<string, unknown> {
  const clean = cleanRaw(raw);
  for (const field of fieldsToRemove) {
    if (!requiredFields.includes(field)) delete clean[field];
  }
  for (const field of requiredFields) {
    if (clean[field] === undefined)
      throw new Error(`GAM response omitted required field ${field}.`);
  }
  return { ...clean, ...patch };
}

function clonePayload(
  raw: Record<string, unknown>,
  fieldsToRemove: string[],
): Record<string, unknown> {
  const result = cleanRaw(raw);
  for (const field of fieldsToRemove) delete result[field];
  return result;
}

function cleanRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(raw);
  const attributes =
    raw['@'] && typeof raw['@'] === 'object' ? (raw['@'] as Record<string, unknown>) : {};
  const type = raw['@_type'] ?? raw['@_xsi:type'] ?? attributes['xsi:type'];
  if (typeof type === 'string') result.__type = type.split(':').at(-1);
  delete result['@'];
  for (const key of Object.keys(result)) {
    if (key.startsWith('@_')) delete result[key];
  }
  return result;
}

function requireResult(values: unknown[], resourceType: string): unknown {
  const value = values[0];
  if (!value) throw new GamApiError(`${resourceType} write returned no resource.`, 502);
  return value;
}

function normalizeCreativeWrite(value: unknown): Creative {
  return normalizeCreative(value, { includeContent: true });
}

function soapNumber(value: string): string {
  if (!/^\d+$/.test(value)) throw new Error('SOAP numeric value must contain only digits.');
  return value;
}

function soapString(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}
