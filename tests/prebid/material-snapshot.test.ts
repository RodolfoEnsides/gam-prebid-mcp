import { describe, expect, it } from 'vitest';

import { createMaterialSnapshot, detectMaterialDrift } from '../../src/prebid/material-snapshot.js';
import { applicationAuditFixture } from './stage6-fixtures.js';

describe('material GAM snapshots', () => {
  it('detects Order, Line Item, Creative, association, targeting, and new Line Item drift', () => {
    const before = applicationAuditFixture();
    const after = structuredClone(before);
    after.order.status = 'PAUSED';
    after.lineItems[0]!.priority = 13;
    after.lineItems.push({ ...after.lineItems[0]!, id: '999', displayName: 'external' });
    after.creatives[0]!.name = 'changed';
    after.associations.pop();
    after.customTargeting[0]!.values[0]!.status = 'INACTIVE';

    const drift = detectMaterialDrift(
      createMaterialSnapshot(before),
      createMaterialSnapshot(after),
    );

    expect(drift.stale).toBe(true);
    expect(drift.orderChanged).toBe(true);
    expect(drift.lineItems.modified).toContain('201');
    expect(drift.lineItems.added).toContain('999');
    expect(drift.creatives.modified).toContain('400');
    expect(drift.associations.removed).toContain('202:400');
    expect(drift.targeting.modified).toContain('20');
  });

  it('is stable when API arrays arrive in a different order', () => {
    const before = applicationAuditFixture();
    const after = structuredClone(before);
    after.lineItems.reverse();
    after.associations.reverse();

    expect(
      detectMaterialDrift(createMaterialSnapshot(before), createMaterialSnapshot(after)).stale,
    ).toBe(false);
  });
});
