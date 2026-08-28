import type { AuditFinding, OrderAuditResult } from '../audit/models.js';
import type { OrderAuditService } from '../audit/order-audit-service.js';
import type {
  Creative,
  CustomTargetingKey,
  LineItem,
  LineItemCreativeAssociation,
} from '../gam/models/resources.js';
import type {
  PrebidAuditRequest,
  PrebidComparisonResult,
  PrebidOrderAuditResult,
  PrebidProblemGroups,
} from './audit-models.js';
import type { ParsedPrebidConfig, PrebidTargetingKey } from './models.js';
import { PREBID_TARGETING_KEYS } from './models.js';
import type { PriceBucketEngine } from './price-bucket-engine.js';

type TargetingIndex = {
  byName: Map<string, CustomTargetingKey>;
  valuesById: Map<string, string>;
};

export class PrebidAuditService {
  constructor(
    private readonly orderAudit: OrderAuditService,
    private readonly engine: PriceBucketEngine,
  ) {}

  async compare(request: PrebidAuditRequest): Promise<PrebidComparisonResult> {
    const audit = await this.orderAudit.execute(request.networkCode, request.orderId);
    return this.compareAudit(request, audit);
  }

  async audit(request: PrebidAuditRequest): Promise<PrebidOrderAuditResult> {
    const gamAudit = await this.orderAudit.execute(request.networkCode, request.orderId);
    return {
      mode: 'GAM_WITH_PREBID',
      comparison: this.compareAudit(request, gamAudit),
      gamAudit,
    };
  }

  async validateTargeting(request: PrebidAuditRequest) {
    const audit = await this.orderAudit.execute(request.networkCode, request.orderId);
    const problems = inspectTargeting(request.config, audit);
    return {
      mode: 'GAM_WITH_PREBID' as const,
      orderId: request.orderId,
      valid: problems.length === 0,
      requiredKeys: requiredTargetingKeys(request.config),
      configuredKeys: request.config.targetingKeys,
      observedKeys: audit.customTargeting
        .map((key) => normalizeKeyName(key.displayName))
        .filter((key): key is PrebidTargetingKey => isPrebidKey(key)),
      problems,
      warnings: request.config.warnings,
    };
  }

  compareAudit(request: PrebidAuditRequest, audit: OrderAuditResult): PrebidComparisonResult {
    const generated = this.engine.generate(request.config);
    const targeting = targetingIndex(audit.customTargeting);
    const hbPb = targeting.byName.get('hb_pb');
    const lineItemBuckets = extractLineItemBuckets(audit.lineItems, hbPb, targeting.valuesById);
    const observedCurrencies = unique(
      audit.lineItems
        .map((lineItem) => lineItem.costPerUnit?.currencyCode)
        .filter((currency): currency is string => currency !== undefined),
    );
    const existingValues = unique(lineItemBuckets.flatMap((entry) => entry.values));
    const expectedSet = new Set(generated.values);
    const existingSet = new Set(existingValues);
    const missingBuckets = generated.values.filter((value) => !existingSet.has(value));
    const extraBuckets = existingValues.filter((value) => !expectedSet.has(value));
    const correctBuckets = generated.values.filter((value) => existingSet.has(value));

    const problems: PrebidProblemGroups = {
      targeting: inspectTargeting(request.config, audit),
      cpm: inspectCpm(lineItemBuckets, audit.lineItems, request.config.currency),
      precision: inspectPrecision(extraBuckets, generated.values, lineItemBuckets),
      duplicates: inspectDuplicates(lineItemBuckets),
      creative: inspectCreatives(
        request.config,
        request.simultaneousAdUnits,
        audit.lineItems,
        audit.creatives,
        audit.associations,
      ),
    };
    const findings = Object.values(problems).flat();
    const partial = audit.summary.partial;

    return {
      mode: 'GAM_WITH_PREBID',
      orderId: request.orderId,
      summary: {
        expectedBuckets: generated.bucketCount,
        existingBuckets: existingValues.length,
        correctBuckets: correctBuckets.length,
        missingBuckets: missingBuckets.length,
        extraBuckets: extraBuckets.length,
        creativeProblems: problems.creative.length,
        targetingProblems: problems.targeting.length,
        cpmProblems: problems.cpm.length,
        precisionProblems: problems.precision.length,
        duplicates: problems.duplicates.length,
        partial,
      },
      expected: {
        granularity: generated.granularity,
        currency: generated.currency,
        bucketCount: generated.bucketCount,
        ranges: generated.ranges,
        min: generated.min,
        max: generated.max,
        rounding: generated.rounding,
      },
      existing: {
        ...(observedCurrencies.length === 1 ? { currency: observedCurrencies[0] } : {}),
        bucketCount: existingValues.length,
        lineItems: audit.lineItems.length,
        creatives: audit.creatives.length,
      },
      correctBuckets,
      missingBuckets,
      extraBuckets,
      problems,
      findings,
      recommendations: recommendations(missingBuckets, extraBuckets, problems, partial),
      warnings: [
        ...request.config.warnings,
        ...(partial
          ? ['The GAM audit was partial; absence-based conclusions may be incomplete.']
          : []),
      ],
    };
  }
}

function inspectTargeting(config: ParsedPrebidConfig, audit: OrderAuditResult): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const index = targetingIndex(audit.customTargeting);
  const required = requiredTargetingKeys(config);
  for (const key of required) {
    if (!index.byName.has(key)) {
      findings.push(
        finding(
          key === 'hb_pb' ? 'CRITICAL' : 'HIGH',
          'PREBID_TARGETING_KEY_MISSING',
          `Required Prebid targeting key ${key} is not present in this Order audit.`,
          'customTargetingKey',
          undefined,
          { key },
        ),
      );
    }
  }

  const hbPb = index.byName.get('hb_pb');
  if (hbPb && hbPb.status && hbPb.status !== 'ACTIVE') {
    findings.push(
      finding(
        'HIGH',
        'PREBID_HB_PB_INACTIVE',
        'The hb_pb Custom Targeting key is not active.',
        'customTargetingKey',
        hbPb.id,
      ),
    );
  }
  if (hbPb && !audit.lineItems.some((lineItem) => targetsKey(lineItem, hbPb.id))) {
    findings.push(
      finding(
        'CRITICAL',
        'PREBID_HB_PB_NOT_TARGETED',
        'No Line Item in the Order targets hb_pb.',
        'order',
        audit.order.id,
      ),
    );
  }
  return findings;
}

function inspectCpm(
  entries: ReturnType<typeof extractLineItemBuckets>,
  lineItems: LineItem[],
  currency: string,
): AuditFinding[] {
  const byId = new Map(lineItems.map((lineItem) => [lineItem.id, lineItem]));
  return entries.flatMap((entry) => {
    const lineItem = byId.get(entry.lineItemId);
    if (!lineItem || entry.values.length === 0) return [];
    const micros = lineItem.costPerUnit?.micros;
    const cpm = micros === undefined ? undefined : Number(micros) / 1_000_000;
    const bucket = entry.values.length === 1 ? Number(entry.values[0]) : Number.NaN;
    if (
      cpm === undefined ||
      !Number.isFinite(cpm) ||
      !Number.isFinite(bucket) ||
      Math.abs(cpm - bucket) > 0.000001
    ) {
      return [
        finding(
          'HIGH',
          'PREBID_CPM_MISMATCH',
          'Line Item CPM does not exactly match its single hb_pb value.',
          'lineItem',
          entry.lineItemId,
          { hbPbValues: entry.values, cpm, currency },
        ),
      ];
    }
    if (lineItem.costPerUnit?.currencyCode && lineItem.costPerUnit.currencyCode !== currency) {
      return [
        finding(
          'HIGH',
          'PREBID_LINE_ITEM_CURRENCY_MISMATCH',
          'Line Item currency differs from the Prebid configuration.',
          'lineItem',
          entry.lineItemId,
          { expected: currency, actual: lineItem.costPerUnit.currencyCode },
        ),
      ];
    }
    return [];
  });
}

function inspectPrecision(
  extras: string[],
  expected: string[],
  entries: ReturnType<typeof extractLineItemBuckets>,
): AuditFinding[] {
  const expectedByNumeric = new Map(expected.map((value) => [Number(value), value]));
  const lineIdsByValue = new Map<string, string[]>();
  for (const entry of entries) {
    for (const value of entry.values) {
      lineIdsByValue.set(value, [...(lineIdsByValue.get(value) ?? []), entry.lineItemId]);
    }
  }
  return extras.flatMap((value) => {
    const canonical = expectedByNumeric.get(Number(value));
    if (!canonical || canonical === value) return [];
    return [
      finding(
        'HIGH',
        'PREBID_HB_PB_PRECISION_MISMATCH',
        `hb_pb value ${value} has non-canonical precision; expected ${canonical}.`,
        'customTargetingValue',
        undefined,
        { value, expected: canonical, lineItemIds: lineIdsByValue.get(value) ?? [] },
      ),
    ];
  });
}

function inspectDuplicates(entries: ReturnType<typeof extractLineItemBuckets>): AuditFinding[] {
  const lineIdsByBucket = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const value of entry.values) {
      const ids = lineIdsByBucket.get(value) ?? new Set<string>();
      ids.add(entry.lineItemId);
      lineIdsByBucket.set(value, ids);
    }
  }
  return [...lineIdsByBucket.entries()].flatMap(([bucket, ids]) =>
    ids.size > 1
      ? [
          finding(
            'WARNING',
            'PREBID_BUCKET_DUPLICATE',
            `Multiple Line Items target hb_pb=${bucket}.`,
            'lineItem',
            undefined,
            { bucket, lineItemIds: [...ids] },
          ),
        ]
      : [],
  );
}

function inspectCreatives(
  config: ParsedPrebidConfig,
  simultaneousAdUnits: number,
  lineItems: LineItem[],
  creatives: Creative[],
  associations: LineItemCreativeAssociation[],
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const creativeById = new Map(creatives.map((creative) => [creative.id, creative]));
  const associationsByLineItem = groupBy(associations, (association) => association.lineItemId);
  const inspectedCreativeIds = new Set<string>();

  for (const lineItem of lineItems) {
    const linked = associationsByLineItem.get(lineItem.id) ?? [];
    const distinctActiveCreativeIds = unique(
      linked
        .filter((association) => !association.status || association.status === 'ACTIVE')
        .map((association) => association.creativeId),
    );
    if (distinctActiveCreativeIds.length < simultaneousAdUnits) {
      findings.push(
        finding(
          'HIGH',
          'PREBID_INSUFFICIENT_CREATIVES',
          `Line Item has ${distinctActiveCreativeIds.length} distinct active creative(s); ${simultaneousAdUnits} are required for the configured simultaneous Ad Units.`,
          'lineItem',
          lineItem.id,
          { actual: distinctActiveCreativeIds.length, expected: simultaneousAdUnits },
        ),
      );
    }
    for (const association of linked) {
      const creative = creativeById.get(association.creativeId);
      if (!creative || inspectedCreativeIds.has(creative.id)) continue;
      inspectedCreativeIds.add(creative.id);
      if (config.universalCreative.enabled && creative.prebidUniversalCreative !== true) {
        findings.push(
          finding(
            'HIGH',
            'PREBID_UNIVERSAL_CREATIVE_NOT_DETECTED',
            'Prebid Universal Creative markers were not detected in the associated Creative.',
            'creative',
            creative.id,
          ),
        );
      }
      const sizes = creative.sizes.map((size) => size.canonicalName);
      if (config.universalCreative.require1x1 && !sizes.includes('1x1')) {
        findings.push(
          finding(
            'HIGH',
            'PREBID_CREATIVE_1X1_MISSING',
            'Creative does not include the required 1x1 size.',
            'creative',
            creative.id,
          ),
        );
      }
      const missingSizes = config.universalCreative.expectedSizes.filter(
        (size) => !sizes.includes(size),
      );
      if (missingSizes.length > 0) {
        findings.push(
          finding(
            'HIGH',
            'PREBID_CREATIVE_PLACEHOLDER_SIZE_MISMATCH',
            'Creative does not cover all configured placeholder sizes.',
            'creative',
            creative.id,
            { missingSizes },
          ),
        );
      }
    }
  }
  return findings;
}

function extractLineItemBuckets(
  lineItems: LineItem[],
  hbPb: CustomTargetingKey | undefined,
  valuesById: Map<string, string>,
) {
  if (!hbPb) return [];
  return lineItems
    .map((lineItem) => ({
      lineItemId: lineItem.id,
      values: unique(
        lineItem.targeting.customCriteria
          .filter((criterion) => criterion.keyId === hbPb.id)
          .flatMap((criterion) => criterion.valueIds)
          .map((id) => valuesById.get(id))
          .filter((value): value is string => value !== undefined),
      ),
    }))
    .filter((entry) => entry.values.length > 0);
}

function targetingIndex(keys: CustomTargetingKey[]): TargetingIndex {
  const byName = new Map<string, CustomTargetingKey>();
  const valuesById = new Map<string, string>();
  for (const key of keys) {
    byName.set(normalizeKeyName(key.displayName), key);
    for (const value of key.values) valuesById.set(value.id, value.displayName);
  }
  return { byName, valuesById };
}

function requiredTargetingKeys(config: ParsedPrebidConfig): PrebidTargetingKey[] {
  return config.targetingKeysExplicit ? unique(['hb_pb', ...config.targetingKeys]) : ['hb_pb'];
}

function targetsKey(lineItem: LineItem, keyId: string): boolean {
  return lineItem.targeting.customCriteria.some((criterion) => criterion.keyId === keyId);
}

function normalizeKeyName(value: string): string {
  return value.trim().toLowerCase();
}

function isPrebidKey(value: string): value is PrebidTargetingKey {
  return PREBID_TARGETING_KEYS.includes(value as PrebidTargetingKey);
}

function recommendations(
  missing: string[],
  extra: string[],
  problems: PrebidProblemGroups,
  partial: boolean,
): string[] {
  const result: string[] = [];
  if (partial) result.push('Repeat the comparison after resolving partial GAM API responses.');
  if (missing.length > 0) result.push('Review the missing hb_pb buckets before any GAM change.');
  if (extra.length > 0) result.push('Confirm whether extra hb_pb buckets are intentional.');
  if (problems.cpm.length > 0) result.push('Align Line Item CPM and currency with hb_pb values.');
  if (problems.targeting.length > 0)
    result.push('Correct Prebid targeting coverage and key status.');
  if (problems.creative.length > 0) {
    result.push('Validate Universal Creative markers, sizes, and creative multiplicity.');
  }
  return result;
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

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) result.set(key(value), [...(result.get(key(value)) ?? []), value]);
  return result;
}
