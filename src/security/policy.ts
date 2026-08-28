import type { AppConfig } from '../config/env.js';

export class PolicyViolationError extends Error {
  readonly code: 'NETWORK_NOT_ALLOWED' | 'ORDER_NOT_ALLOWED' | 'READ_ONLY' | 'DRY_RUN';

  constructor(code: PolicyViolationError['code'], message: string) {
    super(message);
    this.name = 'PolicyViolationError';
    this.code = code;
  }
}

export class SecurityPolicy {
  constructor(private readonly config: AppConfig['gam']) {}

  assertNetworkAllowed(networkCode: string): void {
    if (!this.config.allowedNetworkCodes.has(networkCode)) {
      throw new PolicyViolationError(
        'NETWORK_NOT_ALLOWED',
        'The requested GAM network is not allowed.',
      );
    }
  }

  assertOrderAllowed(orderId: string): void {
    if (!this.config.allowedOrderIds.has(orderId)) {
      throw new PolicyViolationError(
        'ORDER_NOT_ALLOWED',
        'The requested GAM order is not allowed.',
      );
    }
  }

  assertWriteAllowed(): void {
    if (this.config.readOnly) {
      throw new PolicyViolationError('READ_ONLY', 'Writes are disabled by global read-only mode.');
    }
    if (this.config.dryRun) {
      throw new PolicyViolationError('DRY_RUN', 'Writes are disabled by global dry-run mode.');
    }
  }

  assertWriteExecutionAllowed(requestDryRun: boolean): void {
    if (requestDryRun) {
      throw new PolicyViolationError(
        'DRY_RUN',
        'A dry-run request must never reach the write execution boundary.',
      );
    }
    this.assertWriteAllowed();
  }
}
