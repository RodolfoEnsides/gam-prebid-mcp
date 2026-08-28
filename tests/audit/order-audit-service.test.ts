import { describe, expect, it, vi } from 'vitest';

import { OrderAuditService } from '../../src/audit/order-audit-service.js';
import type { ListResult } from '../../src/gam/models/resources.js';
import type { GamReadService } from '../../src/gam/services/read-service.js';
import {
  emptyOrder,
  customTargetingKey,
  hundredsOfLineItems,
  incorrectCreative,
  normalAssociation,
  normalCreative,
  normalLineItem,
  normalOrder,
} from '../fixtures/gam.js';

const list = <T>(items: T[]): ListResult<T> => ({
  items,
  count: items.length,
  limit: 10_000,
  truncated: false,
  warnings: [],
});

function readService(overrides: Record<string, unknown> = {}): GamReadService {
  return {
    auditOptions: () => ({ limit: 10_000 }),
    concurrency: () => 4,
    getOrder: vi.fn().mockResolvedValue(normalOrder),
    listLineItems: vi.fn().mockResolvedValue(list([normalLineItem])),
    listAssociations: vi.fn().mockResolvedValue(list([normalAssociation])),
    getCreative: vi.fn().mockResolvedValue(normalCreative),
    getCustomTargeting: vi.fn().mockResolvedValue(list([customTargetingKey])),
    ...overrides,
  } as unknown as GamReadService;
}

describe('OrderAuditService', () => {
  it('audits a normal Order', async () => {
    const result = await new OrderAuditService(readService()).execute(undefined, '100');

    expect(result.summary).toMatchObject({ orders: 1, lineItems: 1, creatives: 1, errors: 0 });
    expect(result.findings).toEqual([]);
  });

  it('reports an empty Order', async () => {
    const read = readService({
      getOrder: vi.fn().mockResolvedValue(emptyOrder),
      listLineItems: vi.fn().mockResolvedValue(list([])),
      listAssociations: vi.fn().mockResolvedValue(list([])),
    });

    const result = await new OrderAuditService(read).execute(undefined, '101');

    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'EMPTY_ORDER', severity: 'HIGH' }),
    );
  });

  it('handles hundreds of Line Items in bounded association chunks', async () => {
    const lineItems = hundredsOfLineItems();
    const listAssociations = vi
      .fn()
      .mockImplementation((_networkCode: string | undefined, ids: string[]) =>
        Promise.resolve(
          list(
            ids.map((id) => ({
              ...normalAssociation,
              lineItemId: id,
            })),
          ),
        ),
      );
    const getCreative = vi.fn().mockResolvedValue(normalCreative);
    const read = readService({
      listLineItems: vi.fn().mockResolvedValue(list(lineItems)),
      listAssociations,
      getCreative,
    });

    const result = await new OrderAuditService(read).execute(undefined, '100');

    expect(result.summary.lineItems).toBe(425);
    expect(listAssociations).toHaveBeenCalledTimes(5);
    expect(getCreative).toHaveBeenCalledOnce();
  });

  it('finds a Line Item without a Creative association', async () => {
    const result = await new OrderAuditService(
      readService({ listAssociations: vi.fn().mockResolvedValue(list([])) }),
    ).execute(undefined, '100');

    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'LINE_ITEM_WITHOUT_CREATIVE', severity: 'HIGH' }),
    );
  });

  it('finds an incorrectly sized Creative', async () => {
    const result = await new OrderAuditService(
      readService({ getCreative: vi.fn().mockResolvedValue({ ...incorrectCreative, id: '400' }) }),
    ).execute(undefined, '100');

    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'CREATIVE_SIZE_MISMATCH', severity: 'HIGH' }),
    );
  });

  it('returns a partial audit when the Creative API is unavailable', async () => {
    const result = await new OrderAuditService(
      readService({ getCreative: vi.fn().mockRejectedValue(new Error('unavailable')) }),
    ).execute(undefined, '100');

    expect(result.summary.partial).toBe(true);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'PARTIAL_CREATIVE', severity: 'CRITICAL' }),
    );
  });
});
