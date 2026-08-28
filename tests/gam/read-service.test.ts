import { describe, expect, it, vi } from 'vitest';

import type { GamReadRepository } from '../../src/gam/repositories/read-repository.js';
import { GamReadService } from '../../src/gam/services/read-service.js';
import { SecurityPolicy } from '../../src/security/policy.js';
import { normalLineItem } from '../fixtures/gam.js';
import { createTestConfig } from '../helpers.js';

describe('GamReadService.listOrderLineItems', () => {
  it('returns the targeting key/value catalog used to resolve Line Item criteria', async () => {
    const item = {
      ...normalLineItem,
      targeting: {
        ...normalLineItem.targeting,
        customCriteria: [{ keyId: '11890116', valueIds: ['448095198807'], operator: 'IS' }],
      },
    };
    const repository = {
      listLineItems: vi.fn(async () => ({
        items: [item],
        count: 1,
        limit: 200,
        truncated: false,
        warnings: [],
      })),
      getCustomTargeting: vi.fn(async () => ({
        items: [
          {
            id: '11890116',
            name: 'networks/12345678/customTargetingKeys/11890116',
            displayName: 'Prebid hb_pb',
            adTagName: 'hb_pb',
            values: [
              {
                id: '448095198807',
                name: 'networks/12345678/customTargetingValues/448095198807',
                displayName: '0.20',
                adTagName: '0.20',
              },
            ],
          },
        ],
        count: 1,
        limit: 10_000,
        truncated: false,
        warnings: [],
      })),
    } as unknown as GamReadRepository;
    const config = createTestConfig();
    const service = new GamReadService(config, new SecurityPolicy(config.gam), () => repository);

    const result = await service.listOrderLineItems(undefined, '4030556299', undefined);

    expect(result.items).toHaveLength(1);
    expect(result.targetingCatalog).toMatchObject([
      {
        id: '11890116',
        adTagName: 'hb_pb',
        values: [{ id: '448095198807', adTagName: '0.20' }],
      },
    ]);
    expect(repository.getCustomTargeting).toHaveBeenCalledWith(
      { id: '11890116', customTargetingValueId: '448095198807' },
      { limit: 1 },
    );
  });
});
