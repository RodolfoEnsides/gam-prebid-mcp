import { z } from 'zod/v4';

import type { AppConfig } from '../config/env.js';
import type {
  GamConnectionTestResult,
  GamConnectionTestService,
} from '../gam/services/connection-test-service.js';
import type { Logger } from '../logging/logger.js';
import { serializeSafeError } from '../security/safe-error.js';

export const gamConnectionTestInputSchema = z
  .object({
    networkCode: z
      .string()
      .trim()
      .regex(/^\d+$/, 'Network Code must contain only digits')
      .optional(),
  })
  .strict();

export type GamConnectionTestInput = z.infer<typeof gamConnectionTestInputSchema>;

export function createGamConnectionTestHandler(
  service: GamConnectionTestService,
  config: AppConfig,
  logger: Logger,
) {
  return async (input: GamConnectionTestInput) => {
    try {
      const result = await service.execute(input.networkCode);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      const safeError = serializeSafeError(error);
      logger.error('GAM connection test failed.', {
        code: safeError.code,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      const result: GamConnectionTestResult = {
        operation: 'gam_connection_test',
        resourceType: 'network',
        ...(input.networkCode ? { resourceId: input.networkCode } : {}),
        dryRun: config.gam.dryRun,
        changed: false,
        warnings: [],
        errors: [`${safeError.code}: ${safeError.message}`],
        authenticated: false,
        authorizedNetwork: safeError.code !== 'NETWORK_NOT_ALLOWED',
        accessVerified: false,
        readOnly: config.gam.readOnly,
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result,
        isError: true,
      };
    }
  };
}
