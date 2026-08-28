import { ExecutionCache } from './execution-cache.js';
import type { AuditFinding, OrderAuditResult } from './models.js';
import { summarizeFindings } from './models.js';
import type {
  Creative,
  CustomTargetingKey,
  LineItem,
  LineItemCreativeAssociation,
} from '../gam/models/resources.js';
import type { GamReadService } from '../gam/services/read-service.js';
import { mapConcurrent } from '../utils/concurrency.js';

const priorityRanges: Record<string, [number, number]> = {
  SPONSORSHIP: [2, 5],
  STANDARD: [6, 10],
  NETWORK: [11, 14],
  BULK: [11, 14],
  PRICE_PRIORITY: [11, 14],
  HOUSE: [15, 16],
  CLICK_TRACKING: [1, 16],
  AD_EXCHANGE: [1, 16],
  ADSENSE: [1, 16],
  BUMPER: [15, 16],
  PREFERRED_DEAL: [12, 12],
};

export class OrderAuditService {
  constructor(private readonly read: GamReadService) {}

  async execute(networkCode: string | undefined, orderId: string): Promise<OrderAuditResult> {
    const cache = new ExecutionCache();
    const findings: AuditFinding[] = [];
    const options = this.read.auditOptions();
    const order = await cache.getOrLoad(`order:${orderId}`, () =>
      this.read.getOrder(networkCode, orderId),
    );
    const lineItemResult = await cache.getOrLoad(`order-line-items:${orderId}`, () =>
      this.read.listLineItems(networkCode, { orderId }, options),
    );
    const lineItems = lineItemResult.items;

    if (lineItemResult.truncated) {
      findings.push(
        finding(
          'CRITICAL',
          'PARTIAL_LINE_ITEMS',
          'Line Item audit hit its resource limit.',
          'order',
          orderId,
        ),
      );
    }
    inspectOrder(order.status, orderId, lineItems, findings);
    inspectLineItems(lineItems, findings);
    inspectApparentDuplicates(lineItems, findings);
    const customTargeting = await this.loadCustomTargeting(networkCode, lineItems, findings, cache);
    inspectCustomTargeting(lineItems, customTargeting, findings);

    const associations = await this.loadAssociations(networkCode, lineItems, findings, cache);
    const byLineItem = groupBy(associations, (association) => association.lineItemId);
    if (!findings.some((item) => item.code === 'PARTIAL_ASSOCIATIONS')) {
      for (const lineItem of lineItems) {
        if ((byLineItem.get(lineItem.id)?.length ?? 0) === 0) {
          findings.push(
            finding(
              'HIGH',
              'LINE_ITEM_WITHOUT_CREATIVE',
              'Line Item has no creative association.',
              'lineItem',
              lineItem.id,
            ),
          );
        }
      }
    }

    const creatives = await this.loadCreatives(networkCode, associations, findings, cache);
    inspectCreativeAssociations(lineItems, associations, creatives, findings);

    return {
      summary: summarizeFindings(
        {
          orders: 1,
          lineItems: lineItems.length,
          creatives: creatives.length,
          associations: associations.length,
        },
        findings,
      ),
      order,
      lineItems,
      creatives,
      associations,
      customTargeting,
      findings,
    };
  }

  private async loadCustomTargeting(
    networkCode: string | undefined,
    lineItems: LineItem[],
    findings: AuditFinding[],
    cache: ExecutionCache,
  ): Promise<CustomTargetingKey[]> {
    const pairs = [
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
    const results = await mapConcurrent(pairs, this.read.concurrency(), async (pair) => {
      try {
        const result = await cache.getOrLoad(`custom-targeting:${pair.keyId}:${pair.valueId}`, () =>
          this.read.getCustomTargeting(
            networkCode,
            { id: pair.keyId, customTargetingValueId: pair.valueId },
            { limit: 1 },
          ),
        );
        return result.items;
      } catch {
        findings.push(
          finding(
            'CRITICAL',
            'PARTIAL_CUSTOM_TARGETING',
            'A Custom Targeting key could not be read.',
            'customTargetingKey',
            pair.keyId,
          ),
        );
        return [];
      }
    });
    const byId = new Map<string, CustomTargetingKey>();
    for (const key of results.flat()) {
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

  private async loadAssociations(
    networkCode: string | undefined,
    lineItems: LineItem[],
    findings: AuditFinding[],
    cache: ExecutionCache,
  ): Promise<LineItemCreativeAssociation[]> {
    const chunks = chunk(
      lineItems.map((lineItem) => lineItem.id),
      100,
    );
    const results = await mapConcurrent(chunks, this.read.concurrency(), async (ids) => {
      try {
        return await cache.getOrLoad(`licas:${ids.join(',')}`, () =>
          this.read.listAssociations(networkCode, ids, this.read.auditOptions()),
        );
      } catch {
        findings.push(
          finding(
            'CRITICAL',
            'PARTIAL_ASSOCIATIONS',
            'Creative associations could not be read for part of the Order.',
            'order',
          ),
        );
        return { items: [], count: 0, limit: ids.length, truncated: false, warnings: [] };
      }
    });
    return results.flatMap((result) => result.items);
  }

  private async loadCreatives(
    networkCode: string | undefined,
    associations: LineItemCreativeAssociation[],
    findings: AuditFinding[],
    cache: ExecutionCache,
  ): Promise<Creative[]> {
    const ids = [...new Set(associations.map((association) => association.creativeId))];
    const results = await mapConcurrent(ids, this.read.concurrency(), async (id) => {
      try {
        return await cache.getOrLoad(`creative:${id}`, () =>
          this.read.getCreative(networkCode, id),
        );
      } catch {
        findings.push(
          finding(
            'CRITICAL',
            'PARTIAL_CREATIVE',
            'An associated Creative could not be read.',
            'creative',
            id,
          ),
        );
        return undefined;
      }
    });
    return results.filter((creative): creative is Creative => creative !== undefined);
  }
}

function inspectOrder(
  status: string | undefined,
  orderId: string,
  lineItems: LineItem[],
  findings: AuditFinding[],
): void {
  if (lineItems.length === 0) {
    findings.push(finding('HIGH', 'EMPTY_ORDER', 'Order has no Line Items.', 'order', orderId));
  }
  if (status === 'PAUSED') {
    findings.push(finding('WARNING', 'ORDER_PAUSED', 'Order is paused.', 'order', orderId));
  }
  if (['CANCELED', 'DELETED', 'DISAPPROVED'].includes(status ?? '')) {
    findings.push(
      finding('INFO', 'ORDER_INACTIVE', `Order status is ${status}.`, 'order', orderId),
    );
  }
}

function inspectLineItems(lineItems: LineItem[], findings: AuditFinding[]): void {
  for (const lineItem of lineItems) {
    if (lineItem.status === 'PAUSED') {
      findings.push(
        finding('WARNING', 'LINE_ITEM_PAUSED', 'Line Item is paused.', 'lineItem', lineItem.id),
      );
    }
    if (lineItem.archived) {
      findings.push(
        finding('INFO', 'LINE_ITEM_ARCHIVED', 'Line Item is archived.', 'lineItem', lineItem.id),
      );
    }
    if (lineItem.missingCreatives) {
      findings.push(
        finding(
          'HIGH',
          'MISSING_CREATIVES_FLAG',
          'GAM reports missing creatives.',
          'lineItem',
          lineItem.id,
        ),
      );
    }
    const targeting = lineItem.targeting;
    if (
      targeting.adUnitIds.length === 0 &&
      targeting.placementIds.length === 0 &&
      targeting.customCriteria.length === 0
    ) {
      findings.push(
        finding(
          'WARNING',
          'EMPTY_TARGETING',
          'Line Item has no inventory or custom targeting.',
          'lineItem',
          lineItem.id,
        ),
      );
    }
    const range = lineItem.lineItemType ? priorityRanges[lineItem.lineItemType] : undefined;
    if (
      range &&
      lineItem.priority !== undefined &&
      (lineItem.priority < range[0] || lineItem.priority > range[1])
    ) {
      findings.push(
        finding(
          'HIGH',
          'PRIORITY_TYPE_MISMATCH',
          'Priority is outside the normal range for its Line Item Type.',
          'lineItem',
          lineItem.id,
          {
            lineItemType: lineItem.lineItemType,
            priority: lineItem.priority,
            expectedRange: range,
          },
        ),
      );
    }
    if (lineItem.costType === 'CPM' && !lineItem.costPerUnit?.micros) {
      findings.push(
        finding(
          'HIGH',
          'CPM_MISSING',
          'CPM Line Item has no cost per unit.',
          'lineItem',
          lineItem.id,
        ),
      );
    }
  }
}

function inspectApparentDuplicates(lineItems: LineItem[], findings: AuditFinding[]): void {
  const groups = groupBy(
    lineItems,
    (item) => `${item.displayName.trim().toLowerCase()}|${item.lineItemType ?? ''}`,
  );
  for (const duplicates of groups.values()) {
    if (duplicates.length > 1) {
      findings.push(
        finding(
          'WARNING',
          'APPARENT_DUPLICATE_LINE_ITEMS',
          'Multiple Line Items have the same normalized name and type.',
          'order',
          duplicates[0]?.orderId,
          { lineItemIds: duplicates.map((item) => item.id) },
        ),
      );
    }
  }
}

function inspectCreativeAssociations(
  lineItems: LineItem[],
  associations: LineItemCreativeAssociation[],
  creatives: Creative[],
  findings: AuditFinding[],
): void {
  const lineItemById = new Map(lineItems.map((item) => [item.id, item]));
  const creativeById = new Map(creatives.map((item) => [item.id, item]));
  for (const association of associations) {
    if (association.status && association.status !== 'ACTIVE') {
      findings.push(
        finding(
          'WARNING',
          'ASSOCIATION_INACTIVE',
          `Creative association status is ${association.status}.`,
          'lineItemCreativeAssociation',
          `${association.lineItemId}:${association.creativeId}`,
        ),
      );
    }
    const lineItem = lineItemById.get(association.lineItemId);
    const creative = creativeById.get(association.creativeId);
    if (!lineItem || !creative) continue;
    if (creative.status && !['ACTIVE', 'APPROVED'].includes(creative.status)) {
      findings.push(
        finding(
          'HIGH',
          'CREATIVE_INACTIVE',
          `Associated Creative status is ${creative.status}.`,
          'creative',
          creative.id,
        ),
      );
    }
    const expected = new Set(lineItem.sizes.map((size) => size.canonicalName));
    const actual = creative.sizes.map((size) => size.canonicalName);
    if (expected.size > 0 && actual.length > 0 && !actual.some((size) => expected.has(size))) {
      findings.push(
        finding(
          'HIGH',
          'CREATIVE_SIZE_MISMATCH',
          'Creative size does not match a Line Item placeholder.',
          'creative',
          creative.id,
          {
            lineItemId: lineItem.id,
            expected: [...expected],
            actual,
          },
        ),
      );
    }
  }
}

function inspectCustomTargeting(
  lineItems: LineItem[],
  keys: CustomTargetingKey[],
  findings: AuditFinding[],
): void {
  const keyById = new Map(keys.map((key) => [key.id, key]));
  for (const lineItem of lineItems) {
    for (const criterion of lineItem.targeting.customCriteria) {
      if (!criterion.keyId) continue;
      const key = keyById.get(criterion.keyId);
      if (!key) {
        if (!findings.some((item) => item.code === 'PARTIAL_CUSTOM_TARGETING')) {
          findings.push(
            finding(
              'HIGH',
              'CUSTOM_TARGETING_KEY_NOT_FOUND',
              'A targeted Custom Targeting key was not returned by GAM.',
              'lineItem',
              lineItem.id,
              { keyId: criterion.keyId },
            ),
          );
        }
        continue;
      }
      const knownValues = new Set(key.values.map((value) => value.id));
      const missingValues = criterion.valueIds.filter((id) => !knownValues.has(id));
      if (missingValues.length > 0) {
        findings.push(
          finding(
            'HIGH',
            'CUSTOM_TARGETING_VALUE_NOT_FOUND',
            'A targeted Custom Targeting value was not returned by GAM.',
            'lineItem',
            lineItem.id,
            { keyId: key.id, valueIds: missingValues },
          ),
        );
      }
    }
  }
}

function finding(
  severity: AuditFinding['severity'],
  code: string,
  message: string,
  resourceType: string,
  resourceId?: string,
  evidence?: Record<string, unknown>,
): AuditFinding {
  return {
    severity,
    code,
    message,
    resourceType,
    ...(resourceId ? { resourceId } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) groups.set(key(value), [...(groups.get(key(value)) ?? []), value]);
  return groups;
}

function chunk<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, index * size + size),
  );
}
