import type { AppConfig } from '../config/env.js';
import type { OrderAuditResult } from '../audit/models.js';
import type { OrderAuditService } from '../audit/order-audit-service.js';
import type { WriteItemResult } from '../gam/models/write-models.js';
import type { GamWriteService } from '../gam/services/write-service.js';
import type { SecurityPolicy } from '../security/policy.js';
import type { PrebidAuditService } from './audit-service.js';
import { buildStoredPlan, sealedPlanPayload } from './application-plan-builder.js';
import { GranularityApplicationError } from './application-errors.js';
import type {
  CreateGranularityApplicationRequest,
  PlanAction,
  PlanDryRunResult,
  PlanValidationResult,
  PostApplyValidation,
  StoredGranularityPlan,
} from './application-models.js';
import type { GamGranularityPlanService } from './gam-granularity-plan-service.js';
import type { GranularityPlanningService } from './granularity-planning-service.js';
import {
  canonicalHash,
  createMaterialSnapshot,
  detectMaterialDrift,
  type GamMaterialSnapshot,
} from './material-snapshot.js';
import type { ParsedPrebidConfig } from './models.js';
import type { GranularityPlanStore } from './plan-store.js';

type ActionRun = { action: PlanAction; result: WriteItemResult };

export class GranularityApplicationService {
  constructor(
    private readonly config: AppConfig,
    private readonly policy: SecurityPolicy,
    private readonly orderAudit: OrderAuditService,
    private readonly planning: GranularityPlanningService,
    private readonly gamPlanning: GamGranularityPlanService,
    private readonly prebidAudit: PrebidAuditService,
    private readonly write: GamWriteService,
    private readonly store: GranularityPlanStore,
  ) {}

  async create(request: CreateGranularityApplicationRequest) {
    const networkCode = request.networkCode ?? this.config.gam.networkCode;
    this.policy.assertNetworkAllowed(networkCode);
    this.policy.assertOrderAllowed(request.orderId);
    const audit = await this.orderAudit.execute(networkCode, request.orderId);
    const granularity = this.planning.plan(request.planning);
    const gamPlan = this.gamPlanning.planFromAudit(
      request.orderId,
      granularity,
      request.lineItemTemplate,
      audit,
    );
    const stored = buildStoredPlan(
      networkCode,
      request,
      audit,
      gamPlan,
      this.config.gam.planMaxAgeMs,
    );
    return publicPlan(await this.store.create(stored));
  }

  async dryRun(planId: string): Promise<PlanDryRunResult> {
    let plan = await this.store.get(planId);
    this.policy.assertNetworkAllowed(plan.networkCode);
    this.policy.assertOrderAllowed(plan.orderId);
    this.assertUsable(plan, ['PLANNED', 'DRY_RUN_COMPLETE']);
    if (plan.errors.length > 0) {
      throw new GranularityApplicationError(
        'PLAN_BLOCKED',
        'The plan contains blocking errors and cannot be simulated.',
      );
    }
    const drift = await this.currentDrift(plan, plan.snapshot);
    if (drift.stale) {
      await this.markStale(plan, drift);
      throw new GranularityApplicationError(
        'PLAN_STALE',
        'GAM changed after plan creation. Create a new audit and plan.',
      );
    }
    const results: WriteItemResult[] = [];
    for (const action of orderedActions(plan)) {
      const result = await this.executeAction(action, plan, true);
      results.push(result.result);
      if (!result.result.success) {
        throw new GranularityApplicationError(
          'PLAN_BLOCKED',
          `Dry-run failed at action ${action.actionId}.`,
        );
      }
    }
    const diff = results.flatMap((result) => result.diff ?? []);
    plan = await this.store.update(plan.planId, plan.revision, (current) => ({
      ...current,
      state: 'DRY_RUN_COMPLETE',
      dryRun: { completedAt: new Date().toISOString(), results, diff },
    }));
    return {
      planId: plan.planId,
      state: plan.state,
      dryRun: true,
      changed: false,
      actionCount: orderedActions(plan).length,
      diff,
      warnings: plan.warnings,
      errors: [],
    };
  }

  async validate(planId: string): Promise<PlanValidationResult> {
    let plan = await this.store.get(planId);
    this.policy.assertNetworkAllowed(plan.networkCode);
    this.policy.assertOrderAllowed(plan.orderId);
    this.assertUsable(plan, ['DRY_RUN_COMPLETE']);
    const drift = await this.currentDrift(plan, plan.snapshot);
    if (drift.stale) {
      plan = await this.markStale(plan, drift);
      return {
        planId,
        valid: false,
        state: plan.state,
        immutable: false,
        drift,
        warnings: plan.warnings,
        errors: ['PLAN_STALE: GAM changed after the plan dry-run.'],
      };
    }
    if (plan.errors.length > 0) {
      return {
        planId,
        valid: false,
        state: plan.state,
        immutable: false,
        drift,
        warnings: plan.warnings,
        errors: plan.errors,
      };
    }
    const sealedPlanHash = canonicalHash(sealedPlanPayload(plan));
    plan = await this.store.update(plan.planId, plan.revision, (current) => ({
      ...current,
      state: 'VALIDATED',
      sealedPlanHash,
      validatedAt: new Date().toISOString(),
      checkpointSnapshot: createCheckpoint(drift.actualHash, current.snapshot),
    }));
    return {
      planId,
      valid: true,
      state: plan.state,
      immutable: true,
      sealedPlanHash,
      drift,
      warnings: plan.warnings,
      errors: [],
    };
  }

  async apply(planId: string, dryRun: boolean) {
    if (dryRun) return this.dryRun(planId);
    let plan = await this.store.get(planId);
    this.assertUsable(plan, ['VALIDATED', 'PARTIALLY_APPLIED']);
    this.assertSeal(plan);
    this.policy.assertNetworkAllowed(plan.networkCode);
    this.policy.assertOrderAllowed(plan.orderId);
    this.policy.assertWriteExecutionAllowed(false);
    const drift = await this.currentDrift(plan, plan.checkpointSnapshot);
    if (drift.stale) {
      await this.markStale(plan, drift);
      throw new GranularityApplicationError(
        'PLAN_STALE',
        'Material GAM drift was detected before apply. A new audit and plan are required.',
      );
    }
    plan = await this.store.update(plan.planId, plan.revision, (current) => ({
      ...current,
      state: 'APPLYING',
      execution: clearStop(current.execution),
    }));

    const completedIds = new Set(plan.execution.completed.map((item) => item.actionId));
    const pending = orderedActions(plan).filter((action) => !completedIds.has(action.actionId));
    const batches = chunk(pending, this.config.gam.writeBatchSize);
    for (const batch of batches) {
      const completed = [] as ActionRun[];
      let failure: ActionRun | undefined;
      for (const action of batch) {
        const run = await this.executeAction(action, plan, false);
        if (!run.result.success) {
          failure = run;
          break;
        }
        completed.push(run);
        if (run.result.resourceId && 'ref' in action) {
          plan.execution.resourceRefs[action.ref] = run.result.resourceId;
        }
      }
      const nextRefs = { ...plan.execution.resourceRefs };
      const executions = completed.map(({ action, result }) => ({
        actionId: action.actionId,
        completedAt: new Date().toISOString(),
        ...(result.resourceId ? { resourceId: result.resourceId } : {}),
        changed: result.changed,
        idempotent: result.idempotent,
      }));
      plan = await this.store.update(plan.planId, plan.revision, (current) => ({
        ...current,
        state: failure ? 'PARTIALLY_APPLIED' : 'APPLYING',
        execution: {
          ...current.execution,
          completed: [...current.execution.completed, ...executions],
          resourceRefs: nextRefs,
          batchesCompleted: current.execution.batchesCompleted + 1,
          ...(failure ? { stoppedAtActionId: failure.action.actionId } : {}),
          ...(failure?.result.errors[0] ? { lastError: failure.result.errors[0] } : {}),
        },
      }));
      const audit = await this.orderAudit.execute(plan.networkCode, plan.orderId);
      const checkpointSnapshot = createMaterialSnapshot(audit);
      plan = await this.store.update(plan.planId, plan.revision, (current) => ({
        ...current,
        checkpointSnapshot,
      }));
      if (failure) return applicationReport(plan, audit, false);
    }

    const audit = await this.orderAudit.execute(plan.networkCode, plan.orderId);
    const checkpointSnapshot = createMaterialSnapshot(audit);
    plan = await this.store.update(plan.planId, plan.revision, (current) => ({
      ...current,
      state: 'APPLIED',
      checkpointSnapshot,
      execution: clearStop(current.execution),
    }));
    return applicationReport(plan, audit, true);
  }

  async postAudit(planId: string) {
    let plan = await this.store.get(planId);
    this.policy.assertNetworkAllowed(plan.networkCode);
    this.policy.assertOrderAllowed(plan.orderId);
    this.assertUsable(plan, ['APPLIED', 'POST_AUDITED', 'POST_AUDIT_FAILED']);
    this.assertSeal(plan);
    const audit = await this.orderAudit.execute(plan.networkCode, plan.orderId);
    const comparison = this.prebidAudit.compareAudit(
      {
        networkCode: plan.networkCode,
        orderId: plan.orderId,
        config: prebidConfig(plan),
        simultaneousAdUnits: plan.lineItemTemplate.simultaneousAdUnits,
      },
      audit,
    );
    const validation: PostApplyValidation = {
      missingBuckets: comparison.summary.missingBuckets,
      duplicateBuckets: comparison.summary.duplicates,
      targetingErrors: comparison.summary.targetingProblems,
      creativeWarnings: comparison.summary.creativeProblems,
      cpmErrors: comparison.summary.cpmProblems,
      partial: comparison.summary.partial,
      matchesPlan:
        comparison.summary.missingBuckets === 0 &&
        comparison.summary.duplicates === 0 &&
        comparison.summary.targetingProblems === 0 &&
        comparison.summary.cpmProblems === 0 &&
        !comparison.summary.partial,
    };
    plan = await this.store.update(plan.planId, plan.revision, (current) => ({
      ...current,
      state: validation.matchesPlan ? 'POST_AUDITED' : 'POST_AUDIT_FAILED',
      checkpointSnapshot: createMaterialSnapshot(audit),
      postAudit: { completedAt: new Date().toISOString(), validation },
    }));
    return {
      planId,
      state: plan.state,
      expectedBuckets: comparison.summary.expectedBuckets,
      after: { lineItems: audit.lineItems.length, creatives: audit.creatives.length },
      validation,
      findings: comparison.findings,
      recommendations: comparison.recommendations,
      warnings: comparison.warnings,
      errors: validation.matchesPlan ? [] : ['POST_APPLY_VALIDATION_FAILED'],
    };
  }

  private async executeAction(
    action: PlanAction,
    plan: StoredGranularityPlan,
    dryRun: boolean,
  ): Promise<ActionRun> {
    const options = {
      networkCode: plan.networkCode,
      dryRun,
      continueOnError: false,
      rollbackOnFailure: false,
    };
    if (action.kind === 'CREATE_LINE_ITEM') {
      return one(action, await this.write.createLineItems([action.input], options));
    }
    if (action.kind === 'UPDATE_LINE_ITEM') {
      return one(action, await this.write.updateLineItems([action.input], options));
    }
    if (action.kind === 'CREATE_CREATIVE') {
      return one(action, await this.write.createCreatives([action.input], options));
    }
    if (action.kind === 'CLONE_CREATIVE') {
      return one(action, await this.write.cloneCreatives([action.input], options));
    }
    const lineItemId = resolveRef(action.lineItemRef, plan.execution.resourceRefs);
    const creativeId = resolveRef(action.creativeRef, plan.execution.resourceRefs);
    if (dryRun && (!lineItemId || !creativeId)) {
      return {
        action,
        result: syntheticAssociationResult(action),
      };
    }
    if (!lineItemId || !creativeId) {
      return {
        action,
        result: failedAction(
          'gam_associate_creative',
          'A planned resource reference is unresolved.',
        ),
      };
    }
    return one(
      action,
      await this.write.associateCreatives(
        [{ lineItemId, creativeId, ...(action.sizes ? { sizes: action.sizes } : {}) }],
        options,
      ),
    );
  }

  private async currentDrift(plan: StoredGranularityPlan, expected: GamMaterialSnapshot) {
    const audit = await this.orderAudit.execute(plan.networkCode, plan.orderId);
    return detectMaterialDrift(expected, createMaterialSnapshot(audit));
  }

  private assertUsable(
    plan: StoredGranularityPlan,
    states: StoredGranularityPlan['state'][],
  ): void {
    if (Date.now() > Date.parse(plan.expiresAt)) {
      throw new GranularityApplicationError('PLAN_EXPIRED', 'The plan expired; create a new plan.');
    }
    if (!states.includes(plan.state)) {
      throw new GranularityApplicationError(
        'PLAN_INVALID_STATE',
        `Plan state ${plan.state} is not valid for this operation.`,
      );
    }
  }

  private assertSeal(plan: StoredGranularityPlan): void {
    if (!plan.sealedPlanHash || plan.sealedPlanHash !== canonicalHash(sealedPlanPayload(plan))) {
      throw new GranularityApplicationError(
        'PLAN_TAMPERED',
        'The validated plan content no longer matches its immutable seal.',
      );
    }
  }

  private markStale(
    plan: StoredGranularityPlan,
    drift: Awaited<ReturnType<GranularityApplicationService['currentDrift']>>,
  ) {
    return this.store.update(plan.planId, plan.revision, (current) => ({
      ...current,
      state: 'STALE',
      execution: {
        ...current.execution,
        lastError: `PLAN_STALE: ${JSON.stringify(drift)}`,
      },
    }));
  }
}

function publicPlan(plan: StoredGranularityPlan) {
  return {
    planId: plan.planId,
    planHash: plan.planHash,
    state: plan.state,
    networkCode: plan.networkCode,
    orderId: plan.orderId,
    granularity: plan.granularity,
    summary: {
      expectedBuckets: plan.sourcePlan.selectedGranularity?.lineItems ?? 0,
      lineItemsBefore: plan.snapshot.lineItems.length,
      lineItemsToCreate: plan.create.filter((item) => item.kind === 'CREATE_LINE_ITEM').length,
      lineItemsToUpdate: plan.update.length,
      creativesToCreate: plan.create.filter(
        (item) => item.kind === 'CREATE_CREATIVE' || item.kind === 'CLONE_CREATIVE',
      ).length,
      associationsToCreate: plan.associate.length,
      unchanged: plan.unchanged.length,
      warnings: plan.warnings.length,
      errors: plan.errors.length,
    },
    create: plan.create.map(publicAction),
    update: plan.update,
    associate: plan.associate,
    unchanged: plan.unchanged,
    warnings: plan.warnings,
    errors: plan.errors,
    expiresAt: plan.expiresAt,
    nextStep:
      plan.errors.length === 0
        ? 'Call prebid_apply_granularity_plan with dryRun=true.'
        : 'Resolve errors and create a new plan.',
  };
}

function publicAction(action: PlanAction): unknown {
  if (action.kind !== 'CREATE_CREATIVE') return action;
  return {
    ...action,
    input: {
      ...action.input,
      snippet: {
        redacted: true,
        length: action.input.snippet.length,
        sha256: canonicalHash(action.input.snippet),
      },
    },
  };
}

function orderedActions(plan: StoredGranularityPlan): PlanAction[] {
  return [...plan.create, ...plan.update, ...plan.associate];
}

function one(action: PlanAction, batch: { results: WriteItemResult[] }): ActionRun {
  const result = batch.results[0];
  return {
    action,
    result: result ?? failedAction(action.kind, 'The write service returned no item result.'),
  };
}

function resolveRef(ref: string, values: Record<string, string>): string | undefined {
  return ref.startsWith('new:') ? values[ref] : ref;
}

function syntheticAssociationResult(
  action: Extract<PlanAction, { kind: 'ASSOCIATE_CREATIVE' }>,
): WriteItemResult {
  return {
    timestamp: new Date().toISOString(),
    operation: 'gam_associate_creative',
    resourceType: 'lineItemCreativeAssociation',
    dryRun: true,
    changed: false,
    success: true,
    idempotent: false,
    proposed: {
      lineItemRef: action.lineItemRef,
      creativeRef: action.creativeRef,
      sizes: action.sizes,
    },
    diff: [
      {
        field: '$',
        before: null,
        proposed: { lineItemRef: action.lineItemRef, creativeRef: action.creativeRef },
      },
    ],
    warnings: ['References will be resolved from idempotent create results during apply.'],
    errors: [],
  };
}

function failedAction(operation: string, message: string): WriteItemResult {
  return {
    timestamp: new Date().toISOString(),
    operation,
    resourceType: 'granularityPlanAction',
    dryRun: false,
    changed: false,
    success: false,
    idempotent: false,
    warnings: [],
    errors: [`PLAN_ACTION_FAILED: ${message}`],
  };
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function applicationReport(plan: StoredGranularityPlan, audit: OrderAuditResult, success: boolean) {
  const completed = new Set(plan.execution.completed.map((item) => item.actionId));
  const changed = plan.execution.completed.filter((item) => item.changed);
  const count = (kind: PlanAction['kind']) =>
    orderedActions(plan).filter((item) => item.kind === kind && completed.has(item.actionId))
      .length;
  return {
    planId: plan.planId,
    state: plan.state,
    success,
    expectedBuckets: plan.sourcePlan.selectedGranularity?.lineItems ?? 0,
    before: {
      lineItems: plan.snapshot.lineItems.length,
      creatives: plan.snapshot.creatives.length,
    },
    applied: {
      created: count('CREATE_LINE_ITEM'),
      updated: count('UPDATE_LINE_ITEM'),
      creativesCreated: count('CREATE_CREATIVE') + count('CLONE_CREATIVE'),
      creativeAssociations: count('ASSOCIATE_CREATIVE'),
      changed: changed.length,
      batchesCompleted: plan.execution.batchesCompleted,
    },
    after: { lineItems: audit.lineItems.length, creatives: audit.creatives.length },
    resume: {
      resumable: plan.state === 'PARTIALLY_APPLIED',
      stoppedAtActionId: plan.execution.stoppedAtActionId,
      lastError: plan.execution.lastError,
      remainingActions: orderedActions(plan).length - completed.size,
    },
    nextStep: success
      ? 'Call prebid_post_apply_audit to prove the result matches the plan.'
      : 'Fix the reported transient/precondition failure and call apply again with dryRun=false.',
  };
}

function prebidConfig(plan: StoredGranularityPlan): ParsedPrebidConfig {
  const selected = plan.sourcePlan.selectedGranularity;
  if (!selected) {
    throw new GranularityApplicationError('PLAN_BLOCKED', 'The plan has no selected granularity.');
  }
  return {
    mode: 'GAM_WITH_PREBID',
    granularity: selected.definition,
    currency: selected.currency,
    targetingKeys: ['hb_pb'],
    targetingKeysExplicit: true,
    universalCreative: {
      enabled: plan.creativeStrategy.mode !== 'none',
      require1x1: false,
      expectedSizes: [],
    },
    warnings: [],
    source: 'DIRECT',
  };
}

function createCheckpoint(hash: string, original: GamMaterialSnapshot): GamMaterialSnapshot {
  return hash === original.hash ? original : { ...original, hash };
}

function clearStop(execution: StoredGranularityPlan['execution']) {
  const next = { ...execution };
  delete next.stoppedAtActionId;
  delete next.lastError;
  return next;
}
