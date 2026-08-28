export class GamApiError extends Error {
  readonly status: number;
  readonly apiCode: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(
    message: string,
    status: number,
    options: { apiCode?: string; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'GamApiError';
    this.status = status;
    this.apiCode = options.apiCode;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class RequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The GAM request exceeded the ${timeoutMs}ms timeout.`);
    this.name = 'RequestTimeoutError';
  }
}

export class UnsupportedGamOperationError extends Error {
  constructor(adapter: string, operation: string) {
    super(`${adapter} does not implement ${operation}.`);
    this.name = 'UnsupportedGamOperationError';
  }
}

export const isTransientGamError = (error: unknown): boolean => {
  if (error instanceof GamApiError) {
    return [408, 429, 500, 502, 503, 504].includes(error.status);
  }
  return error instanceof TypeError;
};
