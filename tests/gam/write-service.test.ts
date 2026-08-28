import { describe, expect, it, vi } from 'vitest';

import { WriteAuditLogger } from '../../src/audit/write-audit-logger.js';
import type { Order, LineItem } from '../../src/gam/models/resources.js';
import type { OrderCreate } from '../../src/gam/models/write-models.js';
import type { GamWriteRepository } from '../../src/gam/repositories/write-repository.js';
import { BulkLimitError } from '../../src/gam/services/write-errors.js';
import { GamWriteService } from '../../src/gam/services/write-service.js';
import { SecurityPolicy } from '../../src/security/policy.js';
import { normalLineItem, normalOrder } from '../fixtures/gam.js';
import { createTestConfig, noopLogger } from '../helpers.js';

describe('GamWriteService', () => {
  it('defaults to a non-mutating create preview with a proposed diff', async () => {
    const createOrder = vi.fn();
    const repository = {
      findOrder: async () => undefined,
      createOrder,
    } as unknown as GamWriteRepository;
    const service = writeService(repository);

    const result = await service.createOrders([orderCreate('First')], options(true));

    expect(result.success).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.results[0]).toMatchObject({ dryRun: true, changed: false, success: true });
    expect(result.results[0]?.proposed).toBeDefined();
    expect(result.results[0]?.diff).toHaveLength(1);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('executes only when request and global write gates are explicitly open', async () => {
    const created: Order = {
      ...normalOrder,
      id: '777',
      displayName: 'Created',
      advertiserId: '900',
      traffickerId: '901',
    };
    const createOrder = vi.fn(async () => created);
    const repository = {
      findOrder: async () => undefined,
      createOrder,
    } as unknown as GamWriteRepository;
    const enabled = writeService(repository, { readOnly: false, dryRun: false });

    const executed = await enabled.createOrders([orderCreate('Created')], options(false));
    expect(executed.changed).toBe(true);
    expect(executed.results[0]?.after).toMatchObject({ id: '777' });
    expect(createOrder).toHaveBeenCalledOnce();

    const blocked = await writeService(repository).createOrders(
      [orderCreate('Blocked')],
      options(false),
    );
    expect(blocked.success).toBe(false);
    expect(blocked.results[0]?.errors[0]).toContain('READ_ONLY');
  });

  it('returns idempotent success or a duplicate conflict before create', async () => {
    const exact: Order = {
      ...normalOrder,
      displayName: 'Same',
      advertiserId: '900',
      traffickerId: '901',
      externalOrderId: '42',
    };
    const repository = {
      findOrder: async () => ({ resource: exact, raw: {} }),
    } as unknown as GamWriteRepository;
    const service = writeService(repository);

    const idempotent = await service.createOrders(
      [{ ...orderCreate('Same'), externalOrderId: '42' }],
      options(true),
    );
    expect(idempotent.results[0]).toMatchObject({ success: true, idempotent: true });

    const conflict = await service.createOrders(
      [{ ...orderCreate('Different'), externalOrderId: '42' }],
      options(true),
    );
    expect(conflict.success).toBe(false);
    expect(conflict.results[0]?.errors[0]).toContain('DUPLICATE_RESOURCE_CONFLICT');
  });

  it('blocks a Line Item outside the authorized Order', async () => {
    const createLineItem = vi.fn();
    const repository = {
      getOrder: async () => ({ resource: normalOrder, raw: {} }),
      findLineItem: async () => undefined,
      createLineItem,
    } as unknown as GamWriteRepository;
    const config = createTestConfig({ allowedOrderIds: new Set(['100']) });
    const service = new GamWriteService(
      config,
      new SecurityPolicy(config.gam),
      () => repository,
      new WriteAuditLogger(noopLogger),
    );

    const result = await service.createLineItems(
      [lineItemCreate({ orderId: '999' })],
      options(true),
    );
    expect(result.success).toBe(false);
    expect(result.results[0]?.errors[0]).toContain('ORDER_NOT_ALLOWED');
    expect(createLineItem).not.toHaveBeenCalled();
  });

  it('fails safely when GAM returns a Line Item with different critical fields', async () => {
    const repository = {
      getOrder: async () => ({ resource: normalOrder, raw: {} }),
      findLineItem: async () => undefined,
      createLineItem: async () => ({
        ...normalLineItem,
        id: '777',
        displayName: 'Prebid 1.00',
        orderId: '100',
        costPerUnit: { currencyCode: 'BRL', micros: '1000000' },
      }),
    } as unknown as GamWriteRepository;
    const service = writeService(repository, { readOnly: false, dryRun: false });

    const result = await service.createLineItems(
      [lineItemCreate({ orderId: '100' })],
      options(false),
    );

    expect(result.success).toBe(false);
    expect(result.results[0]?.errors[0]).toContain('POST_WRITE_VERIFICATION_FAILED');
    expect(result.results[0]?.errors[0]).toContain('costPerUnit.currencyCode');
  });

  it('rejects bulk operations over their configured ceiling', async () => {
    const repository = {} as GamWriteRepository;
    const service = writeService(repository, { maxBulkCreate: 1 });

    await expect(
      service.createOrders([orderCreate('One'), orderCreate('Two')], options(true)),
    ).rejects.toThrow(BulkLimitError);
  });

  it('reports partial failures and continues only when explicitly requested', async () => {
    let call = 0;
    const repository = {
      findOrder: async () => undefined,
      createOrder: async (input: OrderCreate) => {
        call += 1;
        if (call === 2) throw new Error('upstream secret');
        return { ...normalOrder, id: String(call), displayName: input.name };
      },
    } as unknown as GamWriteRepository;
    const service = writeService(repository, { readOnly: false, dryRun: false });

    const result = await service.createOrders(
      [orderCreate('One'), orderCreate('Two'), orderCreate('Three')],
      { ...options(false), continueOnError: true },
    );

    expect(result.summary).toMatchObject({ total: 3, succeeded: 2, failed: 1, changed: 2 });
    expect(JSON.stringify(result)).not.toContain('upstream secret');
    expect(result.rollback.attempted).toBe(false);
  });

  it('logically rolls back successful updates after a later failure', async () => {
    const states = new Map<string, Order>([
      ['100', order('100', 'Before A')],
      ['101', order('101', 'Before B')],
    ]);
    let updateCalls = 0;
    const repository = {
      getOrder: async (id: string) => ({ resource: { ...states.get(id)! }, raw: { id } }),
      updateOrder: async (
        snapshot: { resource: Order },
        update: { orderId: string; patch: { name?: string } },
      ) => {
        updateCalls += 1;
        if (update.orderId === '101') throw new Error('second update failed');
        const after = {
          ...snapshot.resource,
          displayName: update.patch.name ?? snapshot.resource.displayName,
        };
        states.set(update.orderId, after);
        return after;
      },
    } as unknown as GamWriteRepository;
    const service = writeService(repository, {
      readOnly: false,
      dryRun: false,
      allowedOrderIds: new Set(['100', '101']),
    });

    const result = await service.updateOrders(
      [
        { orderId: '100', patch: { name: 'After A' } },
        { orderId: '101', patch: { name: 'After B' } },
      ],
      { ...options(false), rollbackOnFailure: true },
    );

    expect(result.success).toBe(false);
    expect(result.rollback).toMatchObject({ attempted: true, succeeded: true });
    expect(result.rollback.resourceIds).toEqual(['100']);
    expect(states.get('100')?.displayName).toBe('Before A');
    expect(updateCalls).toBe(3);
  });
});

function writeService(
  repository: GamWriteRepository,
  overrides: Partial<ReturnType<typeof createTestConfig>['gam']> = {},
) {
  const config = createTestConfig({
    allowedOrderIds: new Set(['100']),
    ...overrides,
  });
  return new GamWriteService(
    config,
    new SecurityPolicy(config.gam),
    () => repository,
    new WriteAuditLogger(noopLogger),
  );
}

function options(dryRun: boolean) {
  return {
    dryRun,
    continueOnError: false,
    rollbackOnFailure: false,
  };
}

function orderCreate(name: string): OrderCreate {
  return { name, advertiserId: '900', traffickerId: '901' };
}

function order(id: string, displayName: string): Order {
  return {
    ...normalOrder,
    id,
    displayName,
    advertiserId: '900',
    traffickerId: '901',
  };
}

function lineItemCreate(overrides: Partial<LineItem> & { orderId: string }) {
  return {
    orderId: overrides.orderId,
    name: 'Prebid 1.00',
    lineItemType: 'PRICE_PRIORITY',
    priority: 12,
    costType: 'CPM' as const,
    costPerUnit: { currencyCode: 'USD', micros: '1000000' },
    startTime: '2026-01-01T00:00:00Z',
    endTime: '2026-12-31T23:59:59Z',
    unlimitedEndTime: false,
    creativePlaceholderSizes: [{ width: 1, height: 1, canonicalName: '1x1' }],
    targeting: normalLineItem.targeting,
    primaryGoal: { goalType: 'NONE', unitType: 'IMPRESSIONS' },
  };
}
