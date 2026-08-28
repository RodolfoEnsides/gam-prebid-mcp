import { GamApiError, RequestTimeoutError } from '../gam/adapters/errors.js';
import { PrebidConfigInputError } from '../prebid/config-loader.js';
import { PriceBucketLimitError } from '../prebid/price-bucket-engine.js';
import { BulkLimitError, PostWriteVerificationError } from '../gam/services/write-errors.js';
import { PolicyViolationError } from './policy.js';
import { GranularityApplicationError } from '../prebid/application-errors.js';

export type SafeError = { code: string; message: string };

export function serializeSafeError(error: unknown): SafeError {
  if (error instanceof GranularityApplicationError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof PolicyViolationError) return { code: error.code, message: error.message };
  if (error instanceof RequestTimeoutError) return { code: 'GAM_TIMEOUT', message: error.message };
  if (error instanceof PrebidConfigInputError) {
    return { code: 'PREBID_CONFIG_INVALID', message: error.message };
  }
  if (error instanceof PriceBucketLimitError) {
    return { code: 'PREBID_BUCKET_LIMIT', message: error.message };
  }
  if (error instanceof BulkLimitError) {
    return { code: 'GAM_BULK_LIMIT', message: error.message };
  }
  if (error instanceof PostWriteVerificationError) {
    return { code: 'POST_WRITE_VERIFICATION_FAILED', message: error.message };
  }
  if (error instanceof GamApiError) {
    return {
      code: error.status === 429 ? 'GAM_RATE_LIMITED' : 'GAM_API_ERROR',
      message:
        error.status === 429
          ? 'Google Ad Manager rate limit was reached. Try again later.'
          : `Google Ad Manager request failed (HTTP ${error.status}).`,
    };
  }
  return { code: 'INTERNAL_ERROR', message: 'The operation failed safely. Check server logs.' };
}
