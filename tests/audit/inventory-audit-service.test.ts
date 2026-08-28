import { describe, expect, it, vi } from 'vitest';

import { InventoryAuditService } from '../../src/audit/inventory-audit-service.js';
import type { GamReadService } from '../../src/gam/services/read-service.js';
import { adUnit, normalLineItem, placement } from '../fixtures/gam.js';

const list = <T>(items: T[]) => ({
  items,
  count: items.length,
  limit: 10_000,
  truncated: false,
  warnings: [],
});

describe('InventoryAuditService', () => {
  it('relates Ad Units, Placements, and Line Items', async () => {
    const read = {
      auditOptions: () => ({ limit: 10_000 }),
      listAdUnits: vi.fn().mockResolvedValue(list([adUnit])),
      listPlacements: vi.fn().mockResolvedValue(list([placement])),
      listLineItems: vi.fn().mockResolvedValue(list([normalLineItem])),
    } as unknown as GamReadService;

    const result = await new InventoryAuditService(read).execute();

    expect(result.summary).toMatchObject({ adUnits: 1, placements: 1, lineItems: 1, errors: 0 });
    expect(result.inventory.coverage).toEqual([
      { adUnitId: '300', placementIds: ['500'], lineItemIds: ['200'] },
    ]);
  });

  it('keeps partial output when one API is unavailable', async () => {
    const read = {
      auditOptions: () => ({ limit: 10_000 }),
      listAdUnits: vi.fn().mockResolvedValue(list([adUnit])),
      listPlacements: vi.fn().mockRejectedValue(new Error('unavailable')),
      listLineItems: vi.fn().mockResolvedValue(list([normalLineItem])),
    } as unknown as GamReadService;

    const result = await new InventoryAuditService(read).execute();

    expect(result.summary.partial).toBe(true);
    expect(result.inventory.adUnits).toHaveLength(1);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'PARTIAL_PLACEMENTS', severity: 'CRITICAL' }),
    );
  });
});
