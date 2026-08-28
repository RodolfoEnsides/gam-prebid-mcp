import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PrebidConfigInputError, PrebidConfigLoader } from '../../src/prebid/config-loader.js';
import { createTestConfig } from '../helpers.js';

describe('PrebidConfigLoader', () => {
  it('keeps Prebid optional and defaults an explicit Prebid parse to medium', async () => {
    const loader = new PrebidConfigLoader(createTestConfig().prebid);
    const result = await loader.load({ config: {} });

    expect(result.mode).toBe('GAM_WITH_PREBID');
    expect(result.granularity.name).toBe('medium');
    expect(result.currency).toBe('USD');
    expect(result.warnings[0]).toContain('default medium');
  });

  it('loads JSON only from allowlisted directories', async () => {
    const fixtures = path.resolve('tests/fixtures');
    const loader = new PrebidConfigLoader({
      ...createTestConfig().prebid,
      allowedConfigDirectories: [fixtures],
    });
    const result = await loader.load({ filePath: path.join(fixtures, 'prebid.config.json') });

    expect(result.source).toBe('FILE');
    expect(result.granularity.name).toBe('dense');
  });

  it('rejects ambiguous sources, traversal, and invalid custom boundaries', async () => {
    const fixtures = path.resolve('tests/fixtures');
    const loader = new PrebidConfigLoader({
      ...createTestConfig().prebid,
      allowedConfigDirectories: [fixtures],
    });

    await expect(loader.load({})).rejects.toThrow(PrebidConfigInputError);
    await expect(
      loader.load({ config: {}, filePath: path.join(fixtures, 'prebid.config.json') }),
    ).rejects.toThrow(PrebidConfigInputError);
    await expect(loader.load({ filePath: path.resolve('package.json') })).rejects.toThrow(
      PrebidConfigInputError,
    );
    await expect(
      loader.load({
        config: {
          priceGranularity: {
            buckets: [
              { max: 1, increment: 0.1 },
              { min: 0.5, max: 2, increment: 0.5 },
            ],
          },
        },
      }),
    ).rejects.toThrow(PrebidConfigInputError);
  });
});
