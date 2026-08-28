import type { AuditFinding, OrderAuditResult } from '../audit/models.js';
import type { GeneratedPriceBuckets, ParsedPrebidConfig } from './models.js';

export type PrebidProblemGroups = {
  creative: AuditFinding[];
  targeting: AuditFinding[];
  cpm: AuditFinding[];
  precision: AuditFinding[];
  duplicates: AuditFinding[];
};

export type PrebidComparisonResult = {
  mode: 'GAM_WITH_PREBID';
  orderId: string;
  summary: {
    expectedBuckets: number;
    existingBuckets: number;
    correctBuckets: number;
    missingBuckets: number;
    extraBuckets: number;
    creativeProblems: number;
    targetingProblems: number;
    cpmProblems: number;
    precisionProblems: number;
    duplicates: number;
    partial: boolean;
  };
  expected: Pick<
    GeneratedPriceBuckets,
    'granularity' | 'currency' | 'bucketCount' | 'ranges' | 'min' | 'max' | 'rounding'
  >;
  existing: {
    currency?: string | undefined;
    bucketCount: number;
    lineItems: number;
    creatives: number;
  };
  correctBuckets: string[];
  missingBuckets: string[];
  extraBuckets: string[];
  problems: PrebidProblemGroups;
  findings: AuditFinding[];
  recommendations: string[];
  warnings: string[];
};

export type PrebidOrderAuditResult = {
  mode: 'GAM_WITH_PREBID';
  comparison: PrebidComparisonResult;
  gamAudit: OrderAuditResult;
};

export type PrebidAuditRequest = {
  networkCode?: string;
  orderId: string;
  config: ParsedPrebidConfig;
  simultaneousAdUnits: number;
};
