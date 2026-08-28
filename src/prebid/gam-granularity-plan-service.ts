import type { OrderAuditResult } from '../audit/models.js';
import type { OrderAuditService } from '../audit/order-audit-service.js';
import type { LineItem } from '../gam/models/resources.js';
import type {
  GamGranularityPlanResult,
  GamLineItemTemplate,
  PlannedLineItemSpec,
} from './gam-plan-models.js';
import type { GranularityPlanResult } from './planning-models.js';
import { identifyPlan } from './plan-hash.js';
import type { PriceBucketEngine } from './price-bucket-engine.js';

export class GamGranularityPlanService {
  constructor(
    private readonly orderAudit: OrderAuditService,
    private readonly engine: PriceBucketEngine,
  ) {}

  async plan(
    networkCode: string | undefined,
    orderId: string,
    granularityPlan: GranularityPlanResult,
    template: GamLineItemTemplate,
  ): Promise<GamGranularityPlanResult> {
    const audit = await this.orderAudit.execute(networkCode, orderId);
    return this.planFromAudit(orderId, granularityPlan, template, audit);
  }

  planFromAudit(
    orderId: string,
    granularityPlan: GranularityPlanResult,
    template: GamLineItemTemplate,
    audit: OrderAuditResult,
  ): GamGranularityPlanResult {
    const selected = granularityPlan.selected;
    if (!selected) {
      return this.blockedPlan(orderId, granularityPlan, audit, [
        conflict(
          'CRITICAL',
          'GRANULARITY_NOT_SELECTED',
          'The source plan did not select an actionable granularity.',
          'order',
          orderId,
        ),
      ]);
    }

    const generated = this.engine.generate({
      mode: 'GAM_WITH_PREBID',
      granularity: selected.definition,
      currency: selected.currency,
      targetingKeys: ['hb_pb'],
      targetingKeysExplicit: true,
      universalCreative: { enabled: true, require1x1: false, expectedSizes: [] },
      warnings: [],
      source: 'DIRECT',
    });
    const currency = generated.currency;
    const hbPbKey = audit.customTargeting.find(
      (key) => key.displayName.trim().toLowerCase() === 'hb_pb',
    );
    const valueById = new Map(hbPbKey?.values.map((value) => [value.id, value.displayName]) ?? []);
    const valueIdByDisplayName = new Map(
      hbPbKey?.values.map((value) => [value.displayName, value.id]) ?? [],
    );
    const linesByBucket = new Map<string, LineItem[]>();
    const conflicts = [...partialConflicts(audit)];
    const itemsPreserved: GamGranularityPlanResult['itemsPreserved'] = [];

    if (!hbPbKey) {
      conflicts.push(
        conflict(
          'CRITICAL',
          'HB_PB_KEY_MISSING',
          'The Order audit did not resolve an hb_pb Custom Targeting key.',
          'order',
          orderId,
        ),
      );
    } else if (hbPbKey.status && hbPbKey.status !== 'ACTIVE') {
      conflicts.push(
        conflict(
          'HIGH',
          'HB_PB_KEY_INACTIVE',
          'The hb_pb Custom Targeting key is not active.',
          'customTargetingKey',
          hbPbKey.id,
        ),
      );
    }
    if (hbPbKey) {
      for (const lineItem of audit.lineItems) {
        const values = unique(
          lineItem.targeting.customCriteria
            .filter((criterion) => criterion.keyId === hbPbKey.id)
            .flatMap((criterion) => criterion.valueIds)
            .map((id) => valueById.get(id))
            .filter((value): value is string => value !== undefined),
        );
        if (values.length > 1) {
          conflicts.push(
            conflict(
              'HIGH',
              'AMBIGUOUS_HB_PB_TARGETING',
              'Line Item targets multiple hb_pb values and cannot be mapped automatically.',
              'lineItem',
              lineItem.id,
              { values },
            ),
          );
          itemsPreserved.push({ lineItemId: lineItem.id, reason: 'Ambiguous hb_pb targeting.' });
          continue;
        }
        const bucket = values[0];
        if (!bucket) {
          itemsPreserved.push({
            lineItemId: lineItem.id,
            reason: 'No hb_pb targeting; outside the granularity plan scope.',
          });
          continue;
        }
        linesByBucket.set(bucket, [...(linesByBucket.get(bucket) ?? []), lineItem]);
      }
    } else {
      itemsPreserved.push(
        ...audit.lineItems.map((lineItem) => ({
          lineItemId: lineItem.id,
          reason: 'Preserved because hb_pb could not be resolved.',
        })),
      );
    }

    const expected = new Set(generated.values);
    const missingTargetingValues = generated.values.filter(
      (bucket) => !valueIdByDisplayName.has(bucket),
    );
    if (hbPbKey && missingTargetingValues.length > 0) {
      conflicts.push(
        conflict(
          'HIGH',
          'HB_PB_TARGETING_VALUES_MISSING',
          'Some planned hb_pb values do not exist in GAM and are prerequisites for Line Item creation.',
          'customTargetingKey',
          hbPbKey.id,
          { values: missingTargetingValues },
        ),
      );
    }
    const lineItemsToCreate: PlannedLineItemSpec[] = [];
    const lineItemsToAlter: GamGranularityPlanResult['lineItemsToAlter'] = [];
    const creativesNeeded: GamGranularityPlanResult['creativesNeeded'] = [];
    const associationsNeeded: GamGranularityPlanResult['associationsNeeded'] = [];
    const activeCreativeIdsByLine = activeCreativeIds(audit);

    for (const bucket of generated.values) {
      const existing = linesByBucket.get(bucket) ?? [];
      if (existing.length === 0) {
        const spec = desiredSpec(
          bucket,
          currency,
          template,
          undefined,
          hbPbKey?.id,
          valueIdByDisplayName.get(bucket),
        );
        lineItemsToCreate.push(spec);
        creativesNeeded.push({
          lineItemReference: spec.reference,
          count: template.simultaneousAdUnits,
          sizes: template.creativePlaceholderSizes,
        });
        associationsNeeded.push({
          lineItemReference: spec.reference,
          count: template.simultaneousAdUnits,
        });
        continue;
      }
      if (existing.length > 1) {
        conflicts.push(
          conflict(
            'HIGH',
            'DUPLICATE_HB_PB_LINE_ITEMS',
            `Multiple Line Items target hb_pb=${bucket}.`,
            'customTargetingValue',
            undefined,
            { bucket, lineItemIds: existing.map((item) => item.id) },
          ),
        );
        itemsPreserved.push(
          ...existing.map((item) => ({
            lineItemId: item.id,
            hbPb: bucket,
            reason: 'Preserved pending duplicate resolution.',
          })),
        );
        continue;
      }
      const lineItem = existing[0];
      if (!lineItem) continue;
      const desired = desiredSpec(
        bucket,
        currency,
        template,
        lineItem.id,
        hbPbKey?.id,
        valueIdByDisplayName.get(bucket),
      );
      const differences = lineItemDifferences(lineItem, desired);
      if (differences.length > 0) {
        lineItemsToAlter.push({
          lineItemId: lineItem.id,
          hbPb: bucket,
          before: lineItemSnapshot(lineItem),
          after: desired,
          reasons: differences,
        });
      } else {
        itemsPreserved.push({
          lineItemId: lineItem.id,
          hbPb: bucket,
          reason: 'Configuration already matches the plan.',
        });
      }
      const currentCreatives = activeCreativeIdsByLine.get(lineItem.id)?.size ?? 0;
      const shortfall = Math.max(0, template.simultaneousAdUnits - currentCreatives);
      if (shortfall > 0) {
        creativesNeeded.push({
          lineItemReference: lineItem.id,
          count: shortfall,
          sizes: template.creativePlaceholderSizes,
        });
        associationsNeeded.push({ lineItemReference: lineItem.id, count: shortfall });
      }
    }

    for (const [bucket, lineItems] of linesByBucket) {
      if (expected.has(bucket)) continue;
      conflicts.push(
        conflict(
          'WARNING',
          'EXTRA_HB_PB_BUCKET_PRESERVED',
          `Existing hb_pb=${bucket} is outside the selected granularity and is preserved.`,
          'customTargetingValue',
          undefined,
          { bucket, lineItemIds: lineItems.map((item) => item.id) },
        ),
      );
      itemsPreserved.push(
        ...lineItems.map((lineItem) => ({
          lineItemId: lineItem.id,
          hbPb: bucket,
          reason: 'Extra bucket preserved for manual review.',
        })),
      );
    }

    const warnings = [
      'Planning output only: no Google Ad Manager data was changed.',
      ...(conflicts.length > 0 ? ['Resolve all conflicts before a future apply operation.'] : []),
    ];
    const body = {
      mode: 'GAM_WITH_PREBID' as const,
      planType: 'GAM_PREBID_GRANULARITY' as const,
      sourceGranularityPlanId: granularityPlan.planId,
      orderId,
      status: conflicts.some((item) => item.severity === 'CRITICAL' || item.severity === 'HIGH')
        ? ('BLOCKED' as const)
        : ('READY' as const),
      dryRun: true as const,
      changed: false as const,
      summary: {
        lineItemsToCreate: lineItemsToCreate.length,
        lineItemsToAlter: lineItemsToAlter.length,
        lineItemsPreserved: itemsPreserved.length,
        creativesNeeded: sum(creativesNeeded.map((item) => item.count)),
        associationsNeeded: sum(associationsNeeded.map((item) => item.count)),
        conflicts: conflicts.length,
        warnings: warnings.length,
      },
      lineItemsToCreate,
      lineItemsToAlter,
      itemsPreserved,
      creativesNeeded,
      associationsNeeded,
      conflicts,
      warnings,
      selectedGranularity: selected,
    };
    return { ...identifyPlan('gam-prebid-granularity', body), ...body };
  }

  private blockedPlan(
    orderId: string,
    granularityPlan: GranularityPlanResult,
    audit: OrderAuditResult,
    conflicts: GamGranularityPlanResult['conflicts'],
  ): GamGranularityPlanResult {
    const allConflicts = [...partialConflicts(audit), ...conflicts];
    const warnings = ['Planning output only: no Google Ad Manager data was changed.'];
    const body = {
      mode: 'GAM_WITH_PREBID' as const,
      planType: 'GAM_PREBID_GRANULARITY' as const,
      sourceGranularityPlanId: granularityPlan.planId,
      orderId,
      status: 'BLOCKED' as const,
      dryRun: true as const,
      changed: false as const,
      summary: {
        lineItemsToCreate: 0,
        lineItemsToAlter: 0,
        lineItemsPreserved: audit.lineItems.length,
        creativesNeeded: 0,
        associationsNeeded: 0,
        conflicts: allConflicts.length,
        warnings: warnings.length,
      },
      lineItemsToCreate: [],
      lineItemsToAlter: [],
      itemsPreserved: audit.lineItems.map((lineItem) => ({
        lineItemId: lineItem.id,
        reason: 'No actionable granularity was selected.',
      })),
      creativesNeeded: [],
      associationsNeeded: [],
      conflicts: allConflicts,
      warnings,
      selectedGranularity: null,
    };
    return { ...identifyPlan('gam-prebid-granularity', body), ...body };
  }
}

function desiredSpec(
  bucket: string,
  currency: string,
  template: GamLineItemTemplate,
  existingId?: string,
  targetingKeyId?: string,
  targetingValueId?: string,
): PlannedLineItemSpec {
  return {
    reference: existingId ?? `new:hb_pb:${bucket}`,
    name: `${template.namePrefix} ${bucket}`,
    hbPb: bucket,
    targeting: {
      key: 'hb_pb',
      ...(targetingKeyId ? { keyId: targetingKeyId } : {}),
      operator: 'IS',
      value: bucket,
      ...(targetingValueId ? { valueId: targetingValueId } : {}),
      valueExists: targetingValueId !== undefined,
    },
    cpm: {
      currencyCode: currency,
      micros: String(Math.round(Number(bucket) * 1_000_000)),
      value: bucket,
    },
    priority: template.priority,
    lineItemType: template.lineItemType,
    costType: 'CPM',
    creativePlaceholderSizes: template.creativePlaceholderSizes,
    creativesNeeded: template.simultaneousAdUnits,
    associationsNeeded: template.simultaneousAdUnits,
  };
}

function lineItemDifferences(lineItem: LineItem, desired: PlannedLineItemSpec): string[] {
  const reasons: string[] = [];
  if (lineItem.costPerUnit?.micros !== desired.cpm.micros) reasons.push('CPM differs.');
  if (lineItem.costPerUnit?.currencyCode !== desired.cpm.currencyCode) {
    reasons.push('Currency differs.');
  }
  if (lineItem.priority !== desired.priority) reasons.push('Priority differs.');
  if (lineItem.lineItemType !== desired.lineItemType) reasons.push('Line Item type differs.');
  if (lineItem.costType !== desired.costType) reasons.push('Cost type differs.');
  if (lineItem.sameAdvertiserExceptionEnabled !== true) {
    reasons.push('Same advertiser exception is not enabled.');
  }
  const sizes = new Set(lineItem.sizes.map((size) => size.canonicalName));
  if (desired.creativePlaceholderSizes.some((size) => !sizes.has(size))) {
    reasons.push('Creative placeholder sizes differ.');
  }
  if (
    lineItem.sizes.some(
      (size) =>
        desired.creativePlaceholderSizes.includes(size.canonicalName) &&
        size.expectedCreativeCount !== desired.creativesNeeded,
    )
  ) {
    reasons.push('Expected creative count differs.');
  }
  return reasons;
}

function lineItemSnapshot(lineItem: LineItem): Record<string, unknown> {
  return {
    name: lineItem.displayName,
    cpm: lineItem.costPerUnit,
    priority: lineItem.priority,
    lineItemType: lineItem.lineItemType,
    costType: lineItem.costType,
    creativePlaceholderSizes: lineItem.sizes.map((size) => size.canonicalName),
    expectedCreativeCounts: Object.fromEntries(
      lineItem.sizes.map((size) => [size.canonicalName, size.expectedCreativeCount]),
    ),
    sameAdvertiserExceptionEnabled: lineItem.sameAdvertiserExceptionEnabled,
  };
}

function activeCreativeIds(audit: OrderAuditResult): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const association of audit.associations) {
    if (association.status && association.status !== 'ACTIVE') continue;
    const ids = result.get(association.lineItemId) ?? new Set<string>();
    ids.add(association.creativeId);
    result.set(association.lineItemId, ids);
  }
  return result;
}

function partialConflicts(audit: OrderAuditResult): GamGranularityPlanResult['conflicts'] {
  return audit.summary.partial
    ? [
        conflict(
          'CRITICAL',
          'PARTIAL_GAM_AUDIT',
          'The GAM audit is partial, so an apply-ready plan cannot be produced safely.',
          'order',
          audit.order.id,
        ),
      ]
    : [];
}

function conflict(
  severity: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL',
  code: string,
  message: string,
  resourceType: string,
  resourceId?: string,
  evidence?: Record<string, unknown>,
) {
  return {
    severity,
    code,
    message,
    resourceType,
    ...(resourceId ? { resourceId } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
