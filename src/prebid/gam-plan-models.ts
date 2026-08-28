import type { AuditFinding } from '../audit/models.js';
import type { GranularityPlanResult } from './planning-models.js';

export type GamLineItemTemplate = {
  namePrefix: string;
  priority: number;
  lineItemType: string;
  costType: 'CPM';
  creativePlaceholderSizes: string[];
  simultaneousAdUnits: number;
};

export type PlannedLineItemSpec = {
  reference: string;
  name: string;
  hbPb: string;
  targeting: {
    key: 'hb_pb';
    keyId?: string;
    operator: 'IS';
    value: string;
    valueId?: string;
    valueExists: boolean;
  };
  cpm: { currencyCode: string; micros: string; value: string };
  priority: number;
  lineItemType: string;
  costType: 'CPM';
  creativePlaceholderSizes: string[];
  creativesNeeded: number;
  associationsNeeded: number;
};

export type GamGranularityPlanResult = {
  mode: 'GAM_WITH_PREBID';
  planType: 'GAM_PREBID_GRANULARITY';
  planId: string;
  planHash: string;
  sourceGranularityPlanId: string;
  orderId: string;
  status: 'READY' | 'BLOCKED';
  dryRun: true;
  changed: false;
  summary: {
    lineItemsToCreate: number;
    lineItemsToAlter: number;
    lineItemsPreserved: number;
    creativesNeeded: number;
    associationsNeeded: number;
    conflicts: number;
    warnings: number;
  };
  lineItemsToCreate: PlannedLineItemSpec[];
  lineItemsToAlter: Array<{
    lineItemId: string;
    hbPb: string;
    before: Record<string, unknown>;
    after: PlannedLineItemSpec;
    reasons: string[];
  }>;
  itemsPreserved: Array<{ lineItemId: string; hbPb?: string; reason: string }>;
  creativesNeeded: Array<{ lineItemReference: string; count: number; sizes: string[] }>;
  associationsNeeded: Array<{ lineItemReference: string; count: number }>;
  conflicts: AuditFinding[];
  warnings: string[];
  selectedGranularity: GranularityPlanResult['selected'];
};
