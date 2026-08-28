import { createHash } from 'node:crypto';

import type { OrderAuditResult } from '../audit/models.js';

export type MaterialResource = { id: string; hash: string; value: unknown };

export type GamMaterialSnapshot = {
  hash: string;
  capturedAt: string;
  order: MaterialResource;
  lineItems: MaterialResource[];
  creatives: MaterialResource[];
  associations: MaterialResource[];
  customTargeting: MaterialResource[];
};

export type DriftReport = {
  stale: boolean;
  expectedHash: string;
  actualHash: string;
  orderChanged: boolean;
  lineItems: ResourceDrift;
  creatives: ResourceDrift;
  associations: ResourceDrift;
  targeting: ResourceDrift;
};

type ResourceDrift = { added: string[]; removed: string[]; modified: string[] };

export function createMaterialSnapshot(audit: OrderAuditResult): GamMaterialSnapshot {
  const order = resource(audit.order.id, audit.order);
  const lineItems = resources(audit.lineItems, (item) => item.id);
  const creatives = resources(audit.creatives, (item) => item.id);
  const associations = resources(
    audit.associations,
    (item) => `${item.lineItemId}:${item.creativeId}`,
  );
  const customTargeting = resources(audit.customTargeting, (item) => item.id);
  const body = { order, lineItems, creatives, associations, customTargeting };
  return { hash: hash(body), capturedAt: new Date().toISOString(), ...body };
}

export function detectMaterialDrift(
  expected: GamMaterialSnapshot,
  actual: GamMaterialSnapshot,
): DriftReport {
  const lineItems = drift(expected.lineItems, actual.lineItems);
  const creatives = drift(expected.creatives, actual.creatives);
  const associations = drift(expected.associations, actual.associations);
  const targeting = drift(expected.customTargeting, actual.customTargeting);
  const orderChanged = expected.order.hash !== actual.order.hash;
  return {
    stale:
      orderChanged ||
      [lineItems, creatives, associations, targeting].some(
        (item) => item.added.length + item.removed.length + item.modified.length > 0,
      ),
    expectedHash: expected.hash,
    actualHash: actual.hash,
    orderChanged,
    lineItems,
    creatives,
    associations,
    targeting,
  };
}

function resource(id: string, value: unknown): MaterialResource {
  const normalized = canonicalize(value);
  return { id, hash: hash(normalized), value: normalized };
}

function resources<T>(values: T[], id: (value: T) => string): MaterialResource[] {
  return values.map((value) => resource(id(value), value)).sort((a, b) => a.id.localeCompare(b.id));
}

function drift(expected: MaterialResource[], actual: MaterialResource[]): ResourceDrift {
  const before = new Map(expected.map((item) => [item.id, item.hash]));
  const after = new Map(actual.map((item) => [item.id, item.hash]));
  return {
    added: [...after.keys()].filter((id) => !before.has(id)).sort(),
    removed: [...before.keys()].filter((id) => !after.has(id)).sort(),
    modified: [...before.keys()]
      .filter((id) => after.has(id) && after.get(id) !== before.get(id))
      .sort(),
  };
}

export function canonicalHash(value: unknown): string {
  return `sha256:${hash(value)}`;
}

function hash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}
