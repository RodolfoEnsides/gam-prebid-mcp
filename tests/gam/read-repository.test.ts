import { describe, expect, it, vi } from 'vitest';

import type { GamRestAdapter } from '../../src/gam/adapters/gam-rest-adapter.js';
import type { GamSoapAdapter } from '../../src/gam/adapters/gam-soap-adapter.js';
import { DefaultGamReadRepository } from '../../src/gam/repositories/read-repository.js';

describe('DefaultGamReadRepository custom targeting', () => {
  it('gets an exact key/value pair without scanning the complete value catalog', async () => {
    const get = vi.fn(async (path: string, normalize: (value: unknown) => unknown) =>
      normalize(
        path.includes('customTargetingKeys')
          ? {
              name: 'networks/1560616/customTargetingKeys/11890116',
              adTagName: 'hb_pb',
            }
          : {
              name: 'networks/1560616/customTargetingValues/448095198807',
              customTargetingKey: 'networks/1560616/customTargetingKeys/11890116',
              adTagName: '0.20',
            },
      ),
    );
    const repository = new DefaultGamReadRepository(
      '1560616',
      50,
      5,
      { get } as unknown as GamRestAdapter,
      {} as GamSoapAdapter,
    );

    const result = await repository.getCustomTargeting(
      { id: '11890116', customTargetingValueId: '448095198807' },
      { limit: 1 },
    );

    expect(result.items[0]).toMatchObject({
      id: '11890116',
      adTagName: 'hb_pb',
      values: [
        {
          id: '448095198807',
          adTagName: '0.20',
          customTargetingKeyId: '11890116',
        },
      ],
    });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('lists values from the network-level REST collection and filters by key', async () => {
    const list = vi.fn(async (input: Record<string, unknown>) => {
      const normalize = input.normalize as (value: unknown) => unknown;
      const isKey = input.collection === 'customTargetingKeys';
      const raw = isKey
        ? {
            name: 'networks/1560616/customTargetingKeys/11890116',
            adTagName: 'hb_pb',
            displayName: 'Prebid hb_pb',
          }
        : {
            name: 'networks/1560616/customTargetingValues/448095198807',
            customTargetingKey: 'networks/1560616/customTargetingKeys/11890116',
            adTagName: '0.20',
            displayName: '0.20',
          };
      return {
        items: [normalize(raw)],
        count: 1,
        limit: 100,
        truncated: false,
        warnings: [],
      };
    });
    const repository = new DefaultGamReadRepository(
      '1560616',
      50,
      5,
      { list } as unknown as GamRestAdapter,
      {} as GamSoapAdapter,
    );

    const result = await repository.getCustomTargeting({ id: '11890116' }, { limit: 100 });

    expect(result.items[0]).toMatchObject({
      id: '11890116',
      adTagName: 'hb_pb',
      values: [{ id: '448095198807', adTagName: '0.20' }],
    });
    expect(list.mock.calls[1]?.[0]).toMatchObject({
      path: '/networks/1560616/customTargetingValues',
      collection: 'customTargetingValues',
      filter: 'customTargetingKey = "networks/1560616/customTargetingKeys/11890116"',
    });
  });
});
