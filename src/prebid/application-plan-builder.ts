import type { OrderAuditResult } from '../audit/models.js';
import type {
  CustomTargetingNode,
  LineItem,
  Size,
  TargetingSummary,
} from '../gam/models/resources.js';
import type {
  LineItemCreate,
  LineItemUpdate,
  ThirdPartyCreativeCreate,
} from '../gam/models/write-models.js';
import type {
  CreateGranularityApplicationRequest,
  PlanAction,
  StoredGranularityPlan,
} from './application-models.js';
import type { GamGranularityPlanResult, PlannedLineItemSpec } from './gam-plan-models.js';
import { canonicalHash, createMaterialSnapshot } from './material-snapshot.js';

export function buildStoredPlan(
  networkCode: string,
  request: CreateGranularityApplicationRequest,
  audit: OrderAuditResult,
  sourcePlan: GamGranularityPlanResult,
  maxAgeMs: number,
): StoredGranularityPlan {
  const createdAt = new Date().toISOString();
  const snapshot = createMaterialSnapshot(audit);
  const seed = {
    createdAt,
    networkCode,
    orderId: request.orderId,
    sourcePlanId: sourcePlan.planId,
    snapshotHash: snapshot.hash,
    creativeStrategy: request.creativeStrategy,
    baseLineItemId: request.baseLineItemId,
  };
  const digest = canonicalHash(seed).slice('sha256:'.length);
  const planId = `prebid-apply:${digest.slice(0, 16)}`;
  const warnings = [
    ...sourcePlan.warnings,
    ...sourcePlan.conflicts
      .filter((item) => item.severity === 'INFO' || item.severity === 'WARNING')
      .map((item) => `${item.code}: ${item.message}`),
  ];
  const errors = sourcePlan.conflicts
    .filter((item) => item.severity === 'HIGH' || item.severity === 'CRITICAL')
    .map((item) => `${item.code}: ${item.message}`);
  const create: PlanAction[] = [];
  const update: PlanAction[] = [];
  const associate: PlanAction[] = [];
  const refs = new Set(sourcePlan.lineItemsToCreate.map((item) => item.reference));
  const base = request.baseLineItemId
    ? audit.lineItems.find((item) => item.id === request.baseLineItemId)
    : undefined;

  if (sourcePlan.lineItemsToCreate.length > 0 && !base) {
    errors.push(
      request.baseLineItemId
        ? 'BASE_LINE_ITEM_NOT_FOUND: baseLineItemId was not found in the audited Order.'
        : 'BASE_LINE_ITEM_REQUIRED: baseLineItemId is required to preserve targeting and delivery settings for new buckets.',
    );
  }
  if (base && base.orderId !== request.orderId) {
    errors.push('BASE_LINE_ITEM_ORDER_MISMATCH: The base Line Item belongs to another Order.');
  }

  for (const spec of sourcePlan.lineItemsToCreate) {
    if (!base) continue;
    const input = createLineItem(request.orderId, planId, base, spec, errors);
    if (input) {
      create.push({
        actionId: actionId('create-line-item', spec.reference),
        phase: 'LINE_ITEM',
        kind: 'CREATE_LINE_ITEM',
        ref: spec.reference,
        input,
      });
    }
  }
  for (const alteration of sourcePlan.lineItemsToAlter) {
    update.push({
      actionId: actionId('update-line-item', alteration.lineItemId),
      phase: 'LINE_ITEM',
      kind: 'UPDATE_LINE_ITEM',
      ref: alteration.lineItemId,
      input: updateLineItem(alteration.lineItemId, alteration.after),
    });
  }

  buildCreativeActions(
    planId,
    request,
    audit,
    sourcePlan,
    refs,
    create,
    associate,
    warnings,
    errors,
  );

  const core = {
    planId,
    networkCode,
    orderId: request.orderId,
    granularity: sourcePlan.selectedGranularity?.name ?? request.planning.mode,
    sourcePlan,
    planningRequest: request.planning,
    creativeStrategy: request.creativeStrategy,
    lineItemTemplate: request.lineItemTemplate,
    ...(request.baseLineItemId ? { baseLineItemId: request.baseLineItemId } : {}),
    snapshot,
    create,
    update,
    associate,
    unchanged: sourcePlan.itemsPreserved,
    warnings: [...new Set(warnings)],
    errors: [...new Set(errors)],
  };
  return {
    schemaVersion: 1,
    revision: 1,
    planHash: canonicalHash(core),
    state: 'PLANNED',
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(Date.parse(createdAt) + maxAgeMs).toISOString(),
    checkpointSnapshot: snapshot,
    execution: { completed: [], resourceRefs: {}, batchesCompleted: 0 },
    ...core,
  };
}

export function sealedPlanPayload(plan: StoredGranularityPlan): unknown {
  return {
    schemaVersion: plan.schemaVersion,
    planId: plan.planId,
    planHash: plan.planHash,
    networkCode: plan.networkCode,
    orderId: plan.orderId,
    granularity: plan.granularity,
    sourcePlan: plan.sourcePlan,
    planningRequest: plan.planningRequest,
    creativeStrategy: plan.creativeStrategy,
    lineItemTemplate: plan.lineItemTemplate,
    baseLineItemId: plan.baseLineItemId,
    snapshot: plan.snapshot,
    create: plan.create,
    update: plan.update,
    associate: plan.associate,
    unchanged: plan.unchanged,
    warnings: plan.warnings,
    errors: plan.errors,
  };
}

function createLineItem(
  orderId: string,
  planId: string,
  base: LineItem,
  spec: PlannedLineItemSpec,
  errors: string[],
): LineItemCreate | undefined {
  if (!base.startTime || !base.primaryGoal?.goalType || !base.primaryGoal.unitType) {
    errors.push(
      'BASE_LINE_ITEM_INCOMPLETE: The base Line Item lacks startTime or a complete primaryGoal.',
    );
    return undefined;
  }
  if (!base.unlimitedEndTime && !base.endTime) {
    errors.push('BASE_LINE_ITEM_INCOMPLETE: The base Line Item lacks an endTime.');
    return undefined;
  }
  if (!spec.targeting.keyId || !spec.targeting.valueId) {
    errors.push(`TARGETING_UNRESOLVED: GAM ids for hb_pb=${spec.hbPb} were not resolved.`);
    return undefined;
  }
  if ((base.targeting.unsupportedPaths?.length ?? 0) > 0) {
    errors.push(
      `BASE_TARGETING_UNSUPPORTED: The base Line Item contains targeting dimensions that cannot be safely recreated: ${base.targeting.unsupportedPaths?.join(', ')}.`,
    );
    return undefined;
  }
  const targeting = replaceHbPb(base.targeting, spec.targeting.keyId, spec.targeting.valueId);
  if (!targeting) {
    errors.push(
      'BASE_HB_PB_TARGETING_AMBIGUOUS: The base Line Item must contain exactly one positive hb_pb criterion.',
    );
    return undefined;
  }
  return {
    orderId,
    name: spec.name,
    lineItemType: spec.lineItemType,
    priority: spec.priority,
    costType: 'CPM',
    costPerUnit: { currencyCode: spec.cpm.currencyCode, micros: spec.cpm.micros },
    startTime: base.startTime,
    ...(base.endTime ? { endTime: base.endTime } : {}),
    unlimitedEndTime: base.unlimitedEndTime ?? false,
    creativePlaceholderSizes: spec.creativePlaceholderSizes.map((value) => ({
      ...size(value),
      expectedCreativeCount: spec.creativesNeeded,
    })),
    targeting,
    primaryGoal: {
      goalType: base.primaryGoal.goalType,
      unitType: base.primaryGoal.unitType,
      ...(base.primaryGoal.units ? { units: base.primaryGoal.units } : {}),
    },
    creativeRotationType: base.creativeRotationType ?? 'OPTIMIZED',
    deliveryRateType: base.deliveryRateType ?? 'EVENLY',
    deliveryForecastSource: base.deliveryForecastSource ?? 'HISTORICAL',
    roadblockingType: base.roadblockingType ?? 'ONE_OR_MORE',
    environmentType: base.environmentType ?? 'BROWSER',
    sameAdvertiserExceptionEnabled: true,
    repeatedCreativeServingEnabled: base.repeatedCreativeServingEnabled ?? false,
    externalId: externalId(planId, 'li', spec.hbPb),
  };
}

function updateLineItem(lineItemId: string, spec: PlannedLineItemSpec): LineItemUpdate {
  return {
    lineItemId,
    patch: {
      lineItemType: spec.lineItemType,
      priority: spec.priority,
      costType: 'CPM',
      costPerUnit: { currencyCode: spec.cpm.currencyCode, micros: spec.cpm.micros },
      creativePlaceholderSizes: spec.creativePlaceholderSizes.map((value) => ({
        ...size(value),
        expectedCreativeCount: spec.creativesNeeded,
      })),
      sameAdvertiserExceptionEnabled: true,
    },
  };
}

function buildCreativeActions(
  planId: string,
  request: CreateGranularityApplicationRequest,
  audit: OrderAuditResult,
  sourcePlan: GamGranularityPlanResult,
  newLineRefs: Set<string>,
  create: PlanAction[],
  associate: PlanAction[],
  warnings: string[],
  errors: string[],
): void {
  const strategy = request.creativeStrategy;
  if (sourcePlan.creativesNeeded.length === 0) return;
  if (strategy.mode === 'none') {
    warnings.push(
      `CREATIVES_NOT_PLANNED: ${sourcePlan.summary.creativesNeeded} creative(s) remain for manual handling.`,
    );
    return;
  }
  const creativeById = new Map(audit.creatives.map((item) => [item.id, item]));
  if (strategy.mode === 'reuse') {
    const creatives = strategy.creativeIds.map((id) => creativeById.get(id));
    if (creatives.some((item) => !item)) {
      errors.push(
        'REUSE_CREATIVE_NOT_AUDITED: Every reused Creative must exist in the Order audit.',
      );
      return;
    }
    const maxNeeded = Math.max(...sourcePlan.creativesNeeded.map((item) => item.count));
    if (strategy.creativeIds.length < maxNeeded) {
      errors.push(
        `REUSE_CREATIVES_INSUFFICIENT: ${maxNeeded} distinct Creatives are required per affected Line Item.`,
      );
      return;
    }
    for (const need of sourcePlan.creativesNeeded) {
      for (const creativeId of strategy.creativeIds.slice(0, need.count)) {
        associate.push(association(need.lineItemReference, creativeId, need.sizes));
      }
    }
    validateCreativeSizes(
      creatives.filter((item) => item !== undefined),
      request.lineItemTemplate.creativePlaceholderSizes,
      errors,
    );
    return;
  }

  const advertiserId = audit.order.advertiserId;
  if (!advertiserId) {
    errors.push('ORDER_ADVERTISER_MISSING: Creative creation requires the Order advertiser id.');
    return;
  }
  if (strategy.mode === 'clone') {
    const source = creativeById.get(strategy.sourceCreativeId);
    if (!source) {
      errors.push('CLONE_SOURCE_NOT_AUDITED: sourceCreativeId must exist in the Order audit.');
      return;
    }
    validateCreativeSizes([source], request.lineItemTemplate.creativePlaceholderSizes, errors);
  } else {
    validateSizeName(
      strategy.template.size.canonicalName,
      request.lineItemTemplate.creativePlaceholderSizes,
      errors,
    );
  }

  for (const need of sourcePlan.creativesNeeded) {
    for (let index = 0; index < need.count; index += 1) {
      const ref = `new:creative:${need.lineItemReference}:${index + 1}`;
      if (strategy.mode === 'clone') {
        create.push({
          actionId: actionId('clone-creative', ref),
          phase: 'CREATIVE',
          kind: 'CLONE_CREATIVE',
          ref,
          input: {
            sourceCreativeId: strategy.sourceCreativeId,
            contextOrderId: request.orderId,
            name: `${request.lineItemTemplate.namePrefix} ${need.lineItemReference} ${index + 1}`,
            externalId: externalId(planId, 'cr', `${need.lineItemReference}-${index + 1}`),
          },
        });
      } else {
        const input: ThirdPartyCreativeCreate = {
          creativeType: 'THIRD_PARTY',
          contextOrderId: request.orderId,
          advertiserId,
          name: `${strategy.template.namePrefix} ${need.lineItemReference} ${index + 1}`,
          size: strategy.template.size,
          snippet: strategy.template.snippet,
          isSafeFrameCompatible: strategy.template.isSafeFrameCompatible,
          externalId: externalId(planId, 'cr', `${need.lineItemReference}-${index + 1}`),
        };
        create.push({
          actionId: actionId('create-creative', ref),
          phase: 'CREATIVE',
          kind: 'CREATE_CREATIVE',
          ref,
          input,
        });
      }
      associate.push(association(need.lineItemReference, ref, need.sizes));
    }
  }
  if ([...newLineRefs].length === 0) return;
}

function association(lineItemRef: string, creativeRef: string, sizes: string[]): PlanAction {
  return {
    actionId: actionId('associate', `${lineItemRef}:${creativeRef}`),
    phase: 'ASSOCIATION',
    kind: 'ASSOCIATE_CREATIVE',
    lineItemRef,
    creativeRef,
    sizes: sizes.map(size),
  };
}

function replaceHbPb(
  targeting: TargetingSummary,
  keyId: string,
  valueId: string,
): TargetingSummary | undefined {
  const sourceTree =
    targeting.customTargeting ??
    (targeting.customCriteria.length > 0
      ? {
          type: 'SET' as const,
          logicalOperator: 'AND' as const,
          children: targeting.customCriteria.map((criterion) => ({
            type: 'CRITERION' as const,
            ...(criterion.keyId ? { keyId: criterion.keyId } : {}),
            valueIds: [...criterion.valueIds],
            operator: criterion.operator ?? 'IS',
          })),
        }
      : undefined);
  if (!sourceTree) return undefined;
  const matches = countCriteria(sourceTree, keyId);
  if (matches !== 1) return undefined;
  const customTargeting = replaceCriterion(sourceTree, keyId, valueId);
  if (!customTargeting) return undefined;
  return {
    adUnitIds: [...targeting.adUnitIds],
    excludedAdUnitIds: [...targeting.excludedAdUnitIds],
    placementIds: [...targeting.placementIds],
    customCriteria: flattenCriteria(customTargeting),
    ...(targeting.adUnits ? { adUnits: targeting.adUnits.map((item) => ({ ...item })) } : {}),
    ...(targeting.excludedAdUnits
      ? { excludedAdUnits: targeting.excludedAdUnits.map((item) => ({ ...item })) }
      : {}),
    customTargeting,
    ...(targeting.unsupportedPaths ? { unsupportedPaths: [...targeting.unsupportedPaths] } : {}),
  };
}

function countCriteria(node: CustomTargetingNode, keyId: string): number {
  if (node.type === 'CRITERION') {
    return node.keyId === keyId && node.operator === 'IS' ? 1 : 0;
  }
  return node.children.reduce((total, child) => total + countCriteria(child, keyId), 0);
}

function replaceCriterion(
  node: CustomTargetingNode,
  keyId: string,
  valueId: string,
): CustomTargetingNode | undefined {
  if (node.type === 'CRITERION') {
    if (node.keyId !== keyId) return { ...node, valueIds: [...node.valueIds] };
    if (node.operator !== 'IS') return undefined;
    return { ...node, valueIds: [valueId] };
  }
  const children = node.children.map((child) => replaceCriterion(child, keyId, valueId));
  if (children.some((child) => child === undefined)) return undefined;
  return { ...node, children: children as CustomTargetingNode[] };
}

function flattenCriteria(node: CustomTargetingNode): TargetingSummary['customCriteria'] {
  if (node.type === 'CRITERION') {
    return [
      {
        ...(node.keyId ? { keyId: node.keyId } : {}),
        valueIds: [...node.valueIds],
        operator: node.operator,
      },
    ];
  }
  return node.children.flatMap(flattenCriteria);
}

function validateCreativeSizes(
  creatives: Array<{ id: string; sizes: Size[] }>,
  expected: string[],
  errors: string[],
): void {
  for (const creative of creatives) {
    const names = creative.sizes.map((item) => item.canonicalName);
    if (!names.some((name) => name === '1x1' || expected.includes(name))) {
      errors.push(
        `CREATIVE_SIZE_MISMATCH: Creative ${creative.id} is incompatible with placeholders.`,
      );
    }
  }
}

function validateSizeName(name: string, expected: string[], errors: string[]): void {
  if (name !== '1x1' && !expected.includes(name)) {
    errors.push(
      'CREATIVE_SIZE_MISMATCH: The creative template size is incompatible with placeholders.',
    );
  }
}

function size(value: string): Size {
  const [width, height] = value.split('x').map(Number);
  return { width, height, canonicalName: value };
}

function actionId(prefix: string, identity: string): string {
  return `${prefix}:${canonicalHash(identity).slice(7, 23)}`;
}

function externalId(planId: string, type: string, identity: string): string {
  return `gpm:${planId.split(':').at(-1)}:${type}:${identity}`.slice(0, 255);
}
