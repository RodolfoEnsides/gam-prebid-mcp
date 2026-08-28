import { describe, expect, it } from 'vitest';

import { GamApiError } from '../../src/gam/adapters/errors.js';
import { PrebidConfigInputError } from '../../src/prebid/config-loader.js';
import { serializeSafeError } from '../../src/security/safe-error.js';
import { sanitizeForLogging } from '../../src/security/sanitize.js';

describe('safe error serialization', () => {
  it('does not expose unknown messages, stacks, or credentials', () => {
    const error = new Error('password=top-secret');
    error.stack = 'stack with top-secret';

    const result = serializeSafeError(error);

    expect(JSON.stringify(result)).not.toContain('top-secret');
    expect(result).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'The operation failed safely. Check server logs.',
    });
  });

  it('maps quota errors and redacts structured log fields', () => {
    expect(serializeSafeError(new GamApiError('quota', 429)).code).toBe('GAM_RATE_LIMITED');
    expect(
      sanitizeForLogging({
        authorization: 'Bearer secret',
        nested: { accessToken: 'secret', safe: 'ok' },
      }),
    ).toEqual({
      authorization: '[REDACTED]',
      nested: { accessToken: '[REDACTED]', safe: 'ok' },
    });
  });

  it('returns safe validation details for Prebid input errors', () => {
    expect(serializeSafeError(new PrebidConfigInputError('Invalid priceGranularity.'))).toEqual({
      code: 'PREBID_CONFIG_INVALID',
      message: 'Invalid priceGranularity.',
    });
  });
});
