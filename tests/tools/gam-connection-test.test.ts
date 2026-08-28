import { describe, expect, it } from 'vitest';

import { GamApiError } from '../../src/gam/adapters/errors.js';
import type { GamConnectionTestService } from '../../src/gam/services/connection-test-service.js';
import {
  createGamConnectionTestHandler,
  gamConnectionTestInputSchema,
} from '../../src/tools/gam-connection-test.js';
import { createTestConfig, noopLogger } from '../helpers.js';

describe('gam_connection_test tool', () => {
  it('rejects invalid input with Zod', () => {
    expect(gamConnectionTestInputSchema.safeParse({ networkCode: 'abc' }).success).toBe(false);
    expect(gamConnectionTestInputSchema.safeParse({ unexpected: true }).success).toBe(false);
  });

  it('returns a safe OperationResult when GAM fails', async () => {
    const service = {
      execute: async () => {
        throw new GamApiError('secret upstream body', 403);
      },
    } as unknown as GamConnectionTestService;
    const handler = createGamConnectionTestHandler(service, createTestConfig(), noopLogger);

    const result = await handler({ networkCode: '12345678' });
    const serialized = JSON.stringify(result);

    expect(result.isError).toBe(true);
    expect(result.structuredContent.errors).toEqual([
      'GAM_API_ERROR: Google Ad Manager request failed (HTTP 403).',
    ]);
    expect(serialized).not.toContain('secret upstream body');
    expect(serialized).not.toContain('stack');
  });
});
