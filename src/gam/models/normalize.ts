import type {
  AdUnit,
  AdUnitTarget,
  Creative,
  CustomCriterion,
  CustomTargetingNode,
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
    ...(numberValue(object.expectedCreativeCount) !== undefined
      ? { expectedCreativeCount: numberValue(object.expectedCreativeCount) }
      : {}),
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

function criterionFrom(value: unknown): CustomTargetingNode | undefined {
  const object = asRecord(value);
  const keyId = stringValue(object.keyId) ?? resourceId(object.customTargetingKey);
  const rawValues = object.valueIds ?? object.customTargetingValues;
  if (!keyId && rawValues === undefined) return undefined;
  return {
    type: 'CRITERION',
    ...(keyId ? { keyId } : {}),
    valueIds: asArray(rawValues)
      .map(resourceId)
      .filter((item): item is string => Boolean(item)),
    operator:
      stringValue(object.operator) ?? (booleanValue(object.negative, false) ? 'IS_NOT' : 'IS'),
  };
}

function setNode(operator: 'AND' | 'OR', children: CustomTargetingNode[]) {
  return children.length > 0
    ? ({ type: 'SET', logicalOperator: operator, children } satisfies CustomTargetingNode)
    : undefined;
}

function normalizeSoapCustomTargeting(value: unknown): CustomTargetingNode | undefined {
  const object = asRecord(value);
  const criterion = criterionFrom(object);
  if (criterion) return criterion;
  const children = asArray(object.children)
    .map(normalizeSoapCustomTargeting)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const operator = stringValue(object.logicalOperator);
  if (operator === 'AND' || operator === 'OR') return setNode(operator, children);
  return children.length === 1 ? children[0] : setNode('AND', children);
}

function normalizeRestCustomTargeting(value: unknown): CustomTargetingNode | undefined {
  const object = asRecord(value);
  const clauses = asArray(object.customTargetingClauses)
    .map((clause) => {
      const literals = asArray(asRecord(clause).customTargetingLiterals)
        .map(criterionFrom)
        .filter((item): item is CustomTargetingNode => Boolean(item));
      return setNode('AND', literals);
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  return clauses.length === 1 ? clauses[0] : setNode('OR', clauses);
}

function flattenCustomCriteria(value: CustomTargetingNode | undefined): CustomCriterion[] {
  if (!value) return [];
  if (value.type === 'CRITERION') {
    return [
      {
        ...(value.keyId ? { keyId: value.keyId } : {}),
        valueIds: [...value.valueIds],
        operator: value.operator,
      },
    ];
  }
  return value.children.flatMap(flattenCustomCriteria);
}

function normalizeAdUnitTargets(value: unknown): AdUnitTarget[] {
  return asArray(value)
    .map((entry) => {
      const object = asRecord(entry);
      const id = resourceId(object.adUnit ?? object.adUnitId);
      return id
        ? { id, includeDescendants: booleanValue(object.includeDescendants, true) }
        : undefined;
    })
    .filter((item): item is AdUnitTarget => Boolean(item));
}

function nonEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(asRecord(value)).length > 0;
}

function unsupportedTargetingPaths(value: unknown): string[] {
  const object = asRecord(value);
  const unsupported = Object.entries(object)
    .filter(
      ([key, child]) => !['inventoryTargeting', 'customTargeting'].includes(key) && nonEmpty(child),
    )
    .map(([key]) => key);
  const custom = asRecord(object.customTargeting);
  for (const clause of asArray(custom.customTargetingClauses)) {
    const clauseObject = asRecord(clause);
    for (const key of ['audienceSegmentTargetings', 'cmsMetadataTargetings']) {
      if (nonEmpty(clauseObject[key])) unsupported.push(`customTargeting.${key}`);
    }
  }
  return [...new Set(unsupported)].sort();
}

export function normalizeTargeting(value: unknown): TargetingSummary {
  const object = asRecord(value);
  const inventory = asRecord(object.inventoryTargeting);
  const adUnits = normalizeAdUnitTargets(inventory.targetedAdUnits);
  const excludedAdUnits = normalizeAdUnitTargets(inventory.excludedAdUnits);
  const restCustom = asRecord(object.customTargeting).customTargetingClauses;
  const customTargeting = restCustom
    ? normalizeRestCustomTargeting(object.customTargeting)
    : normalizeSoapCustomTargeting(object.customTargeting);
  return {
    adUnitIds:
      adUnits.length > 0
        ? adUnits.map((item) => item.id).sort()
        : collectResourceIds(value, /^(adUnit|adUnitId)$/i, /excludedAdUnits/i),
    excludedAdUnitIds:
      excludedAdUnits.length > 0
        ? excludedAdUnits.map((item) => item.id).sort()
        : collectResourceIds(inventory.excludedAdUnits, /^(adUnit|adUnitId)$/i),
    placementIds: collectResourceIds(value, /(placement|targetedPlacements|targetedPlacementIds)/i),
    customCriteria: flattenCustomCriteria(customTargeting),
    ...(adUnits.length > 0 ? { adUnits } : {}),
    ...(excludedAdUnits.length > 0 ? { excludedAdUnits } : {}),
    ...(customTargeting ? { customTargeting } : {}),
    ...(unsupportedTargetingPaths(value).length > 0
      ? { unsupportedPaths: unsupportedTargetingPaths(value) }
      : {}),
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
  // REST v1 names the Line Item billing amount `rate`, while SOAP names the
  // same value `costPerUnit`. Reads use REST and writes use SOAP, so normalize
  // both representations into the shared model.
  const cost = asRecord(object.rate ?? object.costPerUnit);
  const micros = normalizeMoneyMicros(cost);
  const valueCpm = asRecord(object.valueCpm);
  const goal = asRecord(object.goal ?? object.primaryGoal);
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
    ...(dateTimeValue(object.targetEndTime ?? object.endTime ?? object.endDateTime)
      ? { endTime: dateTimeValue(object.targetEndTime ?? object.endTime ?? object.endDateTime) }
      : {}),
    archived: booleanValue(object.archived ?? object.isArchived),
    missingCreatives: booleanValue(object.missingCreatives ?? object.isMissingCreatives),
    ...(stringValue(object.externalLineItemId ?? object.externalId)
      ? { externalId: stringValue(object.externalLineItemId ?? object.externalId) }
      : {}),
    ...(object.endTimeUnlimited !== undefined ||
    object.unlimitedEndDateTime !== undefined ||
    object.unlimitedEndTime !== undefined
      ? {
          unlimitedEndTime: booleanValue(
            object.endTimeUnlimited ?? object.unlimitedEndDateTime ?? object.unlimitedEndTime,
          ),
        }
      : {}),
    ...(Object.keys(goal).length > 0
      ? {
          primaryGoal: {
            ...(stringValue(goal.goalType) ? { goalType: stringValue(goal.goalType) } : {}),
            ...(stringValue(goal.unitType) ? { unitType: stringValue(goal.unitType) } : {}),
            ...(stringValue(goal.units) ? { units: stringValue(goal.units) } : {}),
          },
        }
      : {}),
    ...(stringValue(object.creativeRotationType)
      ? { creativeRotationType: stringValue(object.creativeRotationType) }
      : {}),
    ...(stringValue(object.deliveryRateType)
      ? { deliveryRateType: stringValue(object.deliveryRateType) }
      : {}),
    ...(stringValue(object.deliveryForecastSource)
      ? { deliveryForecastSource: stringValue(object.deliveryForecastSource) }
      : {}),
    ...(stringValue(object.roadblockingType)
      ? { roadblockingType: stringValue(object.roadblockingType) }
      : {}),
    ...(stringValue(object.environmentType)
      ? { environmentType: stringValue(object.environmentType) }
      : {}),
    ...(object.sameAdvertiserExceptionEnabled !== undefined
      ? {
          sameAdvertiserExceptionEnabled: booleanValue(object.sameAdvertiserExceptionEnabled),
        }
      : {}),
    ...(object.repeatedCreativeServingEnabled !== undefined
      ? {
          repeatedCreativeServingEnabled: booleanValue(object.repeatedCreativeServingEnabled),
        }
      : {}),
    ...(Object.keys(valueCpm).length > 0
      ? {
          valueCpm: {
            ...(stringValue(valueCpm.currencyCode)
              ? { currencyCode: stringValue(valueCpm.currencyCode) }
              : {}),
            ...(normalizeMoneyMicros(valueCpm) ? { micros: normalizeMoneyMicros(valueCpm) } : {}),
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
    ...(stringValue(object.adTagName) ? { adTagName: stringValue(object.adTagName) } : {}),
    ...(resourceId(object.customTargetingKey)
      ? { customTargetingKeyId: resourceId(object.customTargetingKey) }
      : {}),
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
    ...(stringValue(object.adTagName) ? { adTagName: stringValue(object.adTagName) } : {}),
    ...(stringValue(object.status) ? { status: stringValue(object.status) } : {}),
    ...(stringValue(object.type) ? { type: stringValue(object.type) } : {}),
    ...(stringValue(object.reportableType)
      ? { reportableType: stringValue(object.reportableType) }
      : {}),
    values: asArray(object.values).map(normalizeCustomTargetingValue),
  };
}
