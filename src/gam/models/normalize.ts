import type {
  AdUnit,
  Creative,
  CustomCriterion,
  CustomTargetingKey,
  CustomTargetingValue,
  LineItem,
  LineItemCreativeAssociation,
  Order,
  Placement,
  Size,
  TargetingSummary,
} from './resources.js';

type UnknownRecord = Record<string, unknown>;

export const asRecord = (value: unknown): UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};

export const asArray = <T = unknown>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const stringValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return undefined;
};

const numberValue = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const booleanValue = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean'
    ? value
    : value === 'true'
      ? true
      : value === 'false'
        ? false
        : fallback;

const dateTimeValue = (value: unknown): string | undefined => {
  const direct = stringValue(value);
  if (direct) return direct;
  const object = asRecord(value);
  const date = asRecord(object.date);
  const year = numberValue(date.year);
  const month = numberValue(date.month);
  const day = numberValue(date.day);
  if (year === undefined || month === undefined || day === undefined) return undefined;
  const timestamp = Date.UTC(
    year,
    month - 1,
    day,
    numberValue(object.hour) ?? 0,
    numberValue(object.minute) ?? 0,
    numberValue(object.second) ?? 0,
  );
  return new Date(timestamp).toISOString();
};

export const resourceId = (value: unknown): string | undefined => {
  const text = stringValue(value);
  return text?.split('/').at(-1);
};

export function normalizeSize(value: unknown): Size | undefined {
  const object = asRecord(value);
  const nested = asRecord(object.size ?? object.adUnitSize);
  const source = Object.keys(nested).length > 0 ? nested : object;
  const width = numberValue(source.width);
  const height = numberValue(source.height);
  const canonical = stringValue(source.canonicalName);
  if (!canonical && width === undefined && height === undefined) return undefined;
  return {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    canonicalName: canonical ?? `${width ?? 'fluid'}x${height ?? 'fluid'}`,
  };
}

const sizesFrom = (...values: unknown[]): Size[] => {
  const sizes = values.flatMap(
    (value) => asArray(value).map(normalizeSize).filter(Boolean) as Size[],
  );
  return [...new Map(sizes.map((size) => [size.canonicalName, size])).values()];
};

function collectResourceIds(value: unknown, keyPattern: RegExp, excludedPath?: RegExp): string[] {
  const found = new Set<string>();
  const visit = (current: unknown, key = '', path = '') => {
    if (keyPattern.test(key) && !excludedPath?.test(path)) {
      const id = resourceId(current);
      if (id) found.add(id);
    }
    if (Array.isArray(current)) current.forEach((item) => visit(item, key, path));
    else if (current !== null && typeof current === 'object') {
      Object.entries(current).forEach(([childKey, child]) =>
        visit(child, childKey, `${path}.${childKey}`),
      );
    }
  };
  visit(value);
  return [...found].sort();
}

function normalizeCustomCriteria(value: unknown): CustomCriterion[] {
  const criteria: CustomCriterion[] = [];
  const visit = (current: unknown) => {
    const object = asRecord(current);
    const keyId = stringValue(object.keyId) ?? resourceId(object.customTargetingKey);
    const rawValues = object.valueIds ?? object.customTargetingValues;
    if (keyId || rawValues) {
      criteria.push({
        ...(keyId ? { keyId } : {}),
        valueIds: asArray(rawValues)
          .map(resourceId)
          .filter((item): item is string => Boolean(item)),
        ...(stringValue(object.operator) ? { operator: stringValue(object.operator) } : {}),
      });
    }
    Object.values(object).forEach((child) => {
      if (child !== current && (Array.isArray(child) || typeof child === 'object')) visit(child);
    });
  };
  visit(value);
  return criteria;
}

export function normalizeTargeting(value: unknown): TargetingSummary {
  return {
    adUnitIds: collectResourceIds(value, /^(adUnit|targetedAdUnits)$/i, /excludedAdUnits/i),
    excludedAdUnitIds: collectResourceIds(value, /excludedAdUnits/i),
    placementIds: collectResourceIds(value, /(placement|targetedPlacements)/i),
    customCriteria: normalizeCustomCriteria(asRecord(value).customTargeting),
  };
}

export function normalizeOrder(value: unknown): Order {
  const object = asRecord(value);
  const name = stringValue(object.name) ?? '';
  const advertiser = stringValue(object.advertiser);
  return {
    id: stringValue(object.orderId) ?? resourceId(name) ?? '',
    name,
    displayName: stringValue(object.displayName ?? object.name) ?? '',
    ...((stringValue(object.advertiserId) ?? (advertiser ? resourceId(advertiser) : undefined))
      ? {
          advertiserId:
            stringValue(object.advertiserId) ?? (advertiser ? resourceId(advertiser) : undefined),
        }
      : {}),
    ...(stringValue(object.advertiserName)
      ? { advertiserName: stringValue(object.advertiserName) }
      : {}),
    ...(stringValue(object.status) ? { status: stringValue(object.status) } : {}),
    ...(dateTimeValue(object.startTime ?? object.startDateTime)
      ? { startTime: dateTimeValue(object.startTime ?? object.startDateTime) }
      : {}),
    ...(dateTimeValue(object.endTime ?? object.endDateTime)
      ? { endTime: dateTimeValue(object.endTime ?? object.endDateTime) }
      : {}),
    ...(stringValue(object.currencyCode) ? { currencyCode: stringValue(object.currencyCode) } : {}),
    ...(stringValue(object.traffickerId) ? { traffickerId: stringValue(object.traffickerId) } : {}),
    ...(stringValue(object.salespersonId)
      ? { salespersonId: stringValue(object.salespersonId) }
      : {}),
    ...(stringValue(object.externalOrderId)
      ? { externalOrderId: stringValue(object.externalOrderId) }
      : {}),
    ...(stringValue(object.poNumber) ? { poNumber: stringValue(object.poNumber) } : {}),
    ...(stringValue(object.notes) ? { notes: stringValue(object.notes) } : {}),
    archived: booleanValue(object.archived),
  };
}

export function normalizeLineItem(value: unknown): LineItem {
  const object = asRecord(value);
  const name = stringValue(object.name) ?? '';
  const order = stringValue(object.order) ?? '';
  const cost = asRecord(object.costPerUnit);
  const micros = normalizeMoneyMicros(cost);
  return {
    id: stringValue(object.lineItemId) ?? resourceId(name) ?? '',
    name,
    displayName: stringValue(object.displayName ?? object.name) ?? '',
    orderId: stringValue(object.orderId) ?? resourceId(order) ?? '',
    ...(stringValue(object.orderDisplayName)
      ? { orderName: stringValue(object.orderDisplayName) }
      : {}),
    ...(stringValue(object.status) ? { status: stringValue(object.status) } : {}),
    ...(stringValue(object.lineItemType) ? { lineItemType: stringValue(object.lineItemType) } : {}),
    ...(numberValue(object.priority) !== undefined
      ? { priority: numberValue(object.priority) }
      : {}),
    ...(stringValue(object.costType) ? { costType: stringValue(object.costType) } : {}),
    ...(Object.keys(cost).length > 0
      ? {
          costPerUnit: {
            ...(stringValue(cost.currencyCode)
              ? { currencyCode: stringValue(cost.currencyCode) }
              : {}),
            ...(micros ? { micros } : {}),
          },
        }
      : {}),
    ...(dateTimeValue(object.startTime ?? object.startDateTime)
      ? { startTime: dateTimeValue(object.startTime ?? object.startDateTime) }
      : {}),
    ...(dateTimeValue(object.endTime ?? object.endDateTime)
      ? { endTime: dateTimeValue(object.endTime ?? object.endDateTime) }
      : {}),
    archived: booleanValue(object.archived),
    missingCreatives: booleanValue(object.missingCreatives),
    ...(stringValue(object.externalId) ? { externalId: stringValue(object.externalId) } : {}),
    ...(object.unlimitedEndDateTime !== undefined || object.unlimitedEndTime !== undefined
      ? {
          unlimitedEndTime: booleanValue(object.unlimitedEndDateTime ?? object.unlimitedEndTime),
        }
      : {}),
    ...(Object.keys(asRecord(object.primaryGoal)).length > 0
      ? {
          primaryGoal: {
            ...(stringValue(asRecord(object.primaryGoal).goalType)
              ? { goalType: stringValue(asRecord(object.primaryGoal).goalType) }
              : {}),
            ...(stringValue(asRecord(object.primaryGoal).unitType)
              ? { unitType: stringValue(asRecord(object.primaryGoal).unitType) }
              : {}),
            ...(stringValue(asRecord(object.primaryGoal).units)
              ? { units: stringValue(asRecord(object.primaryGoal).units) }
              : {}),
          },
        }
      : {}),
    sizes: sizesFrom(object.creativePlaceholders, object.sizes),
    targeting: normalizeTargeting(object.targeting),
  };
}

function normalizeMoneyMicros(value: UnknownRecord): string | undefined {
  const direct = stringValue(value.micros ?? value.microAmount);
  if (direct) return direct;
  const units = stringValue(value.units);
  const nanos = stringValue(value.nanos);
  if (!units && !nanos) return undefined;
  try {
    return (BigInt(units ?? '0') * 1_000_000n + BigInt(nanos ?? '0') / 1_000n).toString();
  } catch {
    return undefined;
  }
}

export function normalizeCreative(
  value: unknown,
  options: { includeContent?: boolean } = {},
): Creative {
  const object = asRecord(value);
  const attributes = asRecord(object['@']);
  const type = stringValue(
    object['@_type'] ?? object['@_xsi:type'] ?? attributes['xsi:type'] ?? object.type,
  );
  const name = stringValue(object.name) ?? '';
  const prebidEvidence = [
    name,
    stringValue(object.snippet),
    stringValue(object.htmlSnippet),
    stringValue(object.thirdPartyData),
  ]
    .filter((item): item is string => Boolean(item))
    .join(' ');
  return {
    id: stringValue(object.id ?? object.creativeId) ?? resourceId(name) ?? '',
    name,
    ...(stringValue(object.advertiserId) ? { advertiserId: stringValue(object.advertiserId) } : {}),
    ...(stringValue(object.status) ? { status: stringValue(object.status) } : {}),
    ...(type ? { type } : {}),
    sizes: sizesFrom(object.size, object.sizes, object.masterCreativeSize),
    ...(stringValue(object.previewUrl) ? { previewUrl: stringValue(object.previewUrl) } : {}),
    ...(stringValue(object.externalId) ? { externalId: stringValue(object.externalId) } : {}),
    ...(options.includeContent && stringValue(object.snippet)
      ? { snippet: stringValue(object.snippet) }
      : {}),
    ...(object.isSafeFrameCompatible !== undefined
      ? { isSafeFrameCompatible: booleanValue(object.isSafeFrameCompatible) }
      : {}),
    ...(prebidEvidence
      ? {
          prebidUniversalCreative:
            /prebid(?:\s+universal\s+creative)?|%%PATTERN:hb_adid%%|ucTag\.renderAd/i.test(
              prebidEvidence,
            ),
        }
      : {}),
  };
}

export function normalizeAssociation(value: unknown): LineItemCreativeAssociation {
  const object = asRecord(value);
  return {
    lineItemId: stringValue(object.lineItemId) ?? '',
    creativeId: stringValue(object.creativeId) ?? '',
    ...(stringValue(object.status) ? { status: stringValue(object.status) } : {}),
    ...(stringValue(object.targetingName)
      ? { targetingName: stringValue(object.targetingName) }
      : {}),
    sizes: sizesFrom(object.sizes, object.size),
  };
}

export function normalizeAdUnit(value: unknown): AdUnit {
  const object = asRecord(value);
  const name = stringValue(object.name) ?? '';
  return {
    id: stringValue(object.adUnitId) ?? resourceId(name) ?? '',
    name,
    displayName: stringValue(object.displayName ?? object.name) ?? '',
    ...(stringValue(object.adUnitCode) ? { code: stringValue(object.adUnitCode) } : {}),
    ...(resourceId(object.parentAdUnit ?? object.parentId)
      ? { parentId: resourceId(object.parentAdUnit ?? object.parentId) }
      : {}),
    ...(stringValue(object.status) ? { status: stringValue(object.status) } : {}),
    ...(object.explicitlyTargeted !== undefined
      ? { explicitlyTargeted: booleanValue(object.explicitlyTargeted) }
      : {}),
    ...(object.hasChildren !== undefined ? { hasChildren: booleanValue(object.hasChildren) } : {}),
    sizes: sizesFrom(object.adUnitSizes, object.sizes),
  };
}

export function normalizePlacement(value: unknown): Placement {
  const object = asRecord(value);
  const name = stringValue(object.name) ?? '';
  return {
    id: stringValue(object.placementId) ?? resourceId(name) ?? '',
    name,
    displayName: stringValue(object.displayName ?? object.name) ?? '',
    ...(stringValue(object.status) ? { status: stringValue(object.status) } : {}),
    adUnitIds: asArray(object.targetedAdUnits ?? object.adUnitIds)
      .map((item) => resourceId(asRecord(item).adUnit ?? item))
      .filter((item): item is string => Boolean(item)),
  };
}

export function normalizeCustomTargetingValue(value: unknown): CustomTargetingValue {
  const object = asRecord(value);
  const name = stringValue(object.name) ?? '';
  return {
    id: stringValue(object.customTargetingValueId ?? object.id) ?? resourceId(name) ?? '',
    name,
    displayName: stringValue(object.displayName ?? object.name) ?? '',
    ...(stringValue(object.status) ? { status: stringValue(object.status) } : {}),
    ...(stringValue(object.matchType) ? { matchType: stringValue(object.matchType) } : {}),
  };
}

export function normalizeCustomTargetingKey(value: unknown): CustomTargetingKey {
  const object = asRecord(value);
  const name = stringValue(object.name) ?? '';
  return {
    id: stringValue(object.customTargetingKeyId ?? object.id) ?? resourceId(name) ?? '',
    name,
    displayName: stringValue(object.displayName ?? object.name) ?? '',
    ...(stringValue(object.status) ? { status: stringValue(object.status) } : {}),
    ...(stringValue(object.type) ? { type: stringValue(object.type) } : {}),
    ...(stringValue(object.reportableType)
      ? { reportableType: stringValue(object.reportableType) }
      : {}),
    values: asArray(object.values).map(normalizeCustomTargetingValue),
  };
}
