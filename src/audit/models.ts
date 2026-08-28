import type {
  AdUnit,
  Creative,
  CustomTargetingKey,
  LineItem,
  LineItemCreativeAssociation,
  Order,
  Placement,
} from '../gam/models/resources.js';

export type FindingSeverity = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';

export type AuditFinding = {
  severity: FindingSeverity;
  code: string;
  message: string;
  resourceType: string;
  resourceId?: string;
  evidence?: Record<string, unknown>;
};

export type AuditSummary = {
  orders: number;
  lineItems: number;
  creatives: number;
  associations: number;
  adUnits: number;
  placements: number;
  info: number;
  warnings: number;
  high: number;
  errors: number;
  partial: boolean;
};

export type OrderAuditResult = {
  summary: AuditSummary;
  order: Order;
  lineItems: LineItem[];
  creatives: Creative[];
  associations: LineItemCreativeAssociation[];
  customTargeting: CustomTargetingKey[];
  findings: AuditFinding[];
};

export type InventoryCoverage = {
  adUnitId: string;
  placementIds: string[];
  lineItemIds: string[];
};

export type InventoryAuditResult = {
  summary: AuditSummary;
  inventory: {
    adUnits: AdUnit[];
    placements: Placement[];
    relatedLineItems: LineItem[];
    coverage: InventoryCoverage[];
  };
  findings: AuditFinding[];
};

export function summarizeFindings(
  counts: Partial<AuditSummary>,
  findings: AuditFinding[],
): AuditSummary {
  return {
    orders: counts.orders ?? 0,
    lineItems: counts.lineItems ?? 0,
    creatives: counts.creatives ?? 0,
    associations: counts.associations ?? 0,
    adUnits: counts.adUnits ?? 0,
    placements: counts.placements ?? 0,
    info: findings.filter((finding) => finding.severity === 'INFO').length,
    warnings: findings.filter((finding) => finding.severity === 'WARNING').length,
    high: findings.filter((finding) => finding.severity === 'HIGH').length,
    errors: findings.filter((finding) => finding.severity === 'CRITICAL').length,
    partial: findings.some((finding) => finding.code.startsWith('PARTIAL_')),
  };
}
