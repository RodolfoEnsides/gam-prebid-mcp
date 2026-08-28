import { ExecutionCache } from './execution-cache.js';
import type { AuditFinding, InventoryAuditResult } from './models.js';
import { summarizeFindings } from './models.js';
import type { AdUnit, LineItem, Placement } from '../gam/models/resources.js';
import type { GamReadService } from '../gam/services/read-service.js';

export class InventoryAuditService {
  constructor(private readonly read: GamReadService) {}

  async execute(networkCode?: string): Promise<InventoryAuditResult> {
    const cache = new ExecutionCache();
    const findings: AuditFinding[] = [];
    const options = this.read.auditOptions();
    const [adUnits, placements, lineItems] = await Promise.all([
      safeLoad(
        'AD_UNITS',
        () => cache.getOrLoad('ad-units', () => this.read.listAdUnits(networkCode, {}, options)),
        findings,
      ),
      safeLoad(
        'PLACEMENTS',
        () =>
          cache.getOrLoad('placements', () => this.read.listPlacements(networkCode, {}, options)),
        findings,
      ),
      safeLoad(
        'LINE_ITEMS',
        () =>
          cache.getOrLoad('line-items', () => this.read.listLineItems(networkCode, {}, options)),
        findings,
      ),
    ]);

    const placementByAdUnit = new Map<string, string[]>();
    for (const placement of placements) {
      if (placement.adUnitIds.length === 0) {
        findings.push(
          finding(
            'WARNING',
            'PLACEMENT_WITHOUT_AD_UNITS',
            'Placement targets no Ad Units.',
            'placement',
            placement.id,
          ),
        );
      }
      for (const adUnitId of placement.adUnitIds) {
        placementByAdUnit.set(adUnitId, [...(placementByAdUnit.get(adUnitId) ?? []), placement.id]);
      }
    }

    const lineItemsByAdUnit = relateLineItemsToAdUnits(lineItems, placements);
    const coverage = adUnits.map((adUnit) => ({
      adUnitId: adUnit.id,
      placementIds: placementByAdUnit.get(adUnit.id) ?? [],
      lineItemIds: lineItemsByAdUnit.get(adUnit.id) ?? [],
    }));

    inspectAdUnits(adUnits, coverage, findings);
    inspectTargetingConflicts(lineItems, placements, findings);

    return {
      summary: summarizeFindings(
        {
          orders: new Set(lineItems.map((item) => item.orderId)).size,
          lineItems: lineItems.length,
          adUnits: adUnits.length,
          placements: placements.length,
        },
        findings,
      ),
      inventory: { adUnits, placements, relatedLineItems: lineItems, coverage },
      findings,
    };
  }
}

async function safeLoad<T>(
  resource: string,
  loader: () => Promise<{ items: T[]; truncated: boolean }>,
  findings: AuditFinding[],
): Promise<T[]> {
  try {
    const result = await loader();
    if (result.truncated) {
      findings.push(
        finding(
          'CRITICAL',
          `PARTIAL_${resource}`,
          `${resource} audit hit its resource limit.`,
          resource.toLowerCase(),
        ),
      );
    }
    return result.items;
  } catch {
    findings.push(
      finding(
        'CRITICAL',
        `PARTIAL_${resource}`,
        `${resource} could not be read; results are partial.`,
        resource.toLowerCase(),
      ),
    );
    return [];
  }
}

function relateLineItemsToAdUnits(
  lineItems: LineItem[],
  placements: Placement[],
): Map<string, string[]> {
  const placementMap = new Map(placements.map((placement) => [placement.id, placement.adUnitIds]));
  const result = new Map<string, string[]>();
  for (const lineItem of lineItems) {
    const adUnitIds = new Set([
      ...lineItem.targeting.adUnitIds,
      ...lineItem.targeting.placementIds.flatMap((id) => placementMap.get(id) ?? []),
    ]);
    for (const id of adUnitIds) result.set(id, [...(result.get(id) ?? []), lineItem.id]);
  }
  return result;
}

function inspectAdUnits(
  adUnits: AdUnit[],
  coverage: InventoryAuditResult['inventory']['coverage'],
  findings: AuditFinding[],
): void {
  for (const adUnit of adUnits) {
    if (adUnit.sizes.length === 0) {
      findings.push(
        finding(
          'HIGH',
          'AD_UNIT_WITHOUT_SIZE',
          'Ad Unit has no declared size.',
          'adUnit',
          adUnit.id,
        ),
      );
    }
    const relation = coverage.find((item) => item.adUnitId === adUnit.id);
    if ((relation?.lineItemIds.length ?? 0) === 0) {
      findings.push(
        finding(
          'INFO',
          'AD_UNIT_WITHOUT_LINE_ITEM',
          'No listed Line Item targets this Ad Unit.',
          'adUnit',
          adUnit.id,
        ),
      );
    }
    if ((relation?.placementIds.length ?? 0) === 0) {
      findings.push(
        finding(
          'INFO',
          'AD_UNIT_WITHOUT_PLACEMENT',
          'Ad Unit belongs to no listed Placement.',
          'adUnit',
          adUnit.id,
        ),
      );
    }
  }
}

function inspectTargetingConflicts(
  lineItems: LineItem[],
  placements: Placement[],
  findings: AuditFinding[],
): void {
  const relations = relateLineItemsToAdUnits(
    lineItems.filter(
      (item) => !item.archived && !['PAUSED', 'CANCELED'].includes(item.status ?? ''),
    ),
    placements,
  );
  const byId = new Map(lineItems.map((item) => [item.id, item]));
  for (const [adUnitId, ids] of relations) {
    const byPriority = new Map<number, string[]>();
    for (const id of ids) {
      const priority = byId.get(id)?.priority;
      if (priority !== undefined)
        byPriority.set(priority, [...(byPriority.get(priority) ?? []), id]);
    }
    for (const [priority, samePriorityIds] of byPriority) {
      if (samePriorityIds.length > 1) {
        findings.push(
          finding(
            'WARNING',
            'POSSIBLE_TARGETING_CONFLICT',
            'Multiple active Line Items target the same Ad Unit at the same priority.',
            'adUnit',
            adUnitId,
            {
              priority,
              lineItemIds: samePriorityIds,
            },
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
