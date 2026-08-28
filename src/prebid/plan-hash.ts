import { createHash } from 'node:crypto';

export function identifyPlan(prefix: string, value: unknown): { planId: string; planHash: string } {
  const digest = createHash('sha256').update(canonicalJson(value)).digest('hex');
  return { planId: `${prefix}:${digest.slice(0, 16)}`, planHash: `sha256:${digest}` };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
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
