import type {
  CreativeAssociationCreate,
  CreativeClone,
  LineItemCreate,
  LineItemUpdate,
  ThirdPartyCreativeCreate,
  WriteItemResult,
} from '../gam/models/write-models.js';
import type { GamGranularityPlanResult, GamLineItemTemplate } from './gam-plan-models.js';
import type { GamMaterialSnapshot, DriftReport } from './material-snapshot.js';
import type { GranularityPlanningRequest } from './planning-models.js';

export type CreativeStrategy =
  | { mode: 'none' }
  | { mode: 'reuse'; creativeIds: string[] }
  | { mode: 'clone'; sourceCreativeId: string }
  | {
      mode: 'create';
      template: {
        namePrefix: string;
        size: { width: number; height: number; canonicalName: string };
        snippet: string;
        isSafeFrameCompatible: boolean;
      };
    };

export type CreateGranularityApplicationRequest = {
  networkCode?: string;
  orderId: string;
  planning: GranularityPlanningRequest;
  lineItemTemplate: GamLineItemTemplate;
  baseLineItemId?: string;
  creativeStrategy: CreativeStrategy;
};

export type PlanAction =
  | {
      actionId: string;
      phase: 'LINE_ITEM';
      kind: 'CREATE_LINE_ITEM';
      ref: string;
      input: LineItemCreate;
    }
  | {
      actionId: string;
      phase: 'LINE_ITEM';
      kind: 'UPDATE_LINE_ITEM';
      ref: string;
      input: LineItemUpdate;
    }
  | {
      actionId: string;
      phase: 'CREATIVE';
      kind: 'CREATE_CREATIVE';
      ref: string;
      input: ThirdPartyCreativeCreate;
    }
  | {
      actionId: string;
      phase: 'CREATIVE';
      kind: 'CLONE_CREATIVE';
      ref: string;
      input: CreativeClone;
    }
  | {
      actionId: string;
      phase: 'ASSOCIATION';
      kind: 'ASSOCIATE_CREATIVE';
      lineItemRef: string;
      creativeRef: string;
      sizes: CreativeAssociationCreate['sizes'];
    };

export type PlanState =
  | 'PLANNED'
  | 'DRY_RUN_COMPLETE'
  | 'VALIDATED'
  | 'APPLYING'
  | 'PARTIALLY_APPLIED'
  | 'APPLIED'
  | 'POST_AUDITED'
  | 'POST_AUDIT_FAILED'
  | 'STALE';

export type ActionExecution = {
  actionId: string;
  completedAt: string;
  resourceId?: string;
  changed: boolean;
  idempotent: boolean;
};

export type StoredGranularityPlan = {
  schemaVersion: 1;
  revision: number;
  planId: string;
  planHash: string;
  state: PlanState;
  networkCode: string;
  orderId: string;
  granularity: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  sourcePlan: GamGranularityPlanResult;
  planningRequest: GranularityPlanningRequest;
  creativeStrategy: CreativeStrategy;
  lineItemTemplate: GamLineItemTemplate;
  baseLineItemId?: string;
  snapshot: GamMaterialSnapshot;
  checkpointSnapshot: GamMaterialSnapshot;
  create: PlanAction[];
  update: PlanAction[];
  associate: PlanAction[];
  unchanged: GamGranularityPlanResult['itemsPreserved'];
  warnings: string[];
  errors: string[];
  sealedPlanHash?: string;
  validatedAt?: string;
  dryRun?: {
    completedAt: string;
    results: WriteItemResult[];
    diff: unknown[];
  };
  execution: {
    completed: ActionExecution[];
    resourceRefs: Record<string, string>;
    stoppedAtActionId?: string;
    lastError?: string;
    batchesCompleted: number;
  };
  postAudit?: {
    completedAt: string;
    validation: PostApplyValidation;
  };
};

export type PostApplyValidation = {
  missingBuckets: number;
  duplicateBuckets: number;
  targetingErrors: number;
  creativeWarnings: number;
  cpmErrors: number;
  partial: boolean;
  matchesPlan: boolean;
};

export type PlanDryRunResult = {
  planId: string;
  state: PlanState;
  dryRun: true;
  changed: false;
  actionCount: number;
  diff: unknown[];
  warnings: string[];
  errors: string[];
};

export type PlanValidationResult = {
  planId: string;
  valid: boolean;
  state: PlanState;
  immutable: boolean;
  sealedPlanHash?: string;
  drift: DriftReport;
  warnings: string[];
  errors: string[];
};
