import { describe, expect, it, vi } from 'vitest';

import type { GamAuthProvider } from '../../src/gam/auth/auth-provider.js';
import type { NetworkRepository } from '../../src/gam/repositories/network-repository.js';
import { GamConnectionTestService } from '../../src/gam/services/connection-test-service.js';
import { SecurityPolicy } from '../../src/security/policy.js';
import { createTestConfig } from '../helpers.js';

describe('GamConnectionTestService', () => {
  it('authenticates and verifies read access without changing data', async () => {
    const config = createTestConfig();
    const auth: GamAuthProvider = {
      authenticate: vi.fn().mockResolvedValue(undefined),
      getAccessToken: vi.fn().mockResolvedValue('test-token'),
    };
    const networks: NetworkRepository = {
      getByCode: vi.fn().mockResolvedValue({
        name: 'networks/12345678',
        networkCode: '12345678',
        displayName: 'Test network',
      }),
    };
    const service = new GamConnectionTestService(
      config,
      new SecurityPolicy(config.gam),
      auth,
      networks,
    );

    const result = await service.execute();

    expect(auth.authenticate).toHaveBeenCalledOnce();
    expect(networks.getByCode).toHaveBeenCalledWith('12345678');
    expect(result).toMatchObject({
      operation: 'gam_connection_test',
      dryRun: true,
      readOnly: true,
      changed: false,
      authenticated: true,
      accessVerified: true,
    });
  });

  it('blocks a non-allowlisted network before authentication or API access', async () => {
    const config = createTestConfig();
    const auth: GamAuthProvider = {
      authenticate: vi.fn().mockResolvedValue(undefined),
      getAccessToken: vi.fn().mockResolvedValue('test-token'),
    };
    const networks: NetworkRepository = { getByCode: vi.fn() };
    const service = new GamConnectionTestService(
      config,
      new SecurityPolicy(config.gam),
      auth,
      networks,
    );

    await expect(service.execute('99999999')).rejects.toMatchObject({
      code: 'NETWORK_NOT_ALLOWED',
    });
    expect(auth.authenticate).not.toHaveBeenCalled();
    expect(networks.getByCode).not.toHaveBeenCalled();
  });
});
