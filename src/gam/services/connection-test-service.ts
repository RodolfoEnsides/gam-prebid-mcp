import type { OperationResult } from '../../audit/operation-result.js';
import type { AppConfig } from '../../config/env.js';
import type { SecurityPolicy } from '../../security/policy.js';
import type { GamAuthProvider } from '../auth/auth-provider.js';
import type { GamNetwork } from '../models/network.js';
import type { NetworkRepository } from '../repositories/network-repository.js';

export type GamConnectionTestResult = OperationResult & {
  authenticated: boolean;
  authorizedNetwork: boolean;
  accessVerified: boolean;
  readOnly: boolean;
  network?: Pick<
    GamNetwork,
    'name' | 'networkCode' | 'displayName' | 'timeZone' | 'currencyCode' | 'testNetwork'
  >;
};

export class GamConnectionTestService {
  constructor(
    private readonly config: AppConfig,
    private readonly policy: SecurityPolicy,
    private readonly auth: GamAuthProvider,
    private readonly networks: NetworkRepository,
  ) {}

  async execute(requestedNetworkCode?: string): Promise<GamConnectionTestResult> {
    const networkCode = requestedNetworkCode ?? this.config.gam.networkCode;
    this.policy.assertNetworkAllowed(networkCode);
    await this.auth.authenticate();
    const network = await this.networks.getByCode(networkCode);
    if (network.networkCode !== networkCode || network.name !== `networks/${networkCode}`) {
      throw new Error('GAM returned a network that does not match the requested Network Code.');
    }

    return {
      operation: 'gam_connection_test',
      resourceType: 'network',
      resourceId: networkCode,
      dryRun: this.config.gam.dryRun,
      changed: false,
      warnings: [],
      errors: [],
      authenticated: true,
      authorizedNetwork: true,
      accessVerified: true,
      readOnly: this.config.gam.readOnly,
      network,
    };
  }
}
