export type RetryOptions = {
  maxRetries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isTransient: (error: unknown) => boolean;
  retryAfterMs?: (error: unknown) => number | undefined;
  sleep?: (milliseconds: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
};

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 5_000;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= options.maxRetries || !options.isTransient(error)) throw error;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const retryAfter = options.retryAfterMs?.(error);
      const delayMs = Math.min(maxDelayMs, Math.max(backoff, retryAfter ?? 0));
      options.onRetry?.(error, attempt + 1, delayMs);
      await sleep(delayMs);
    }
  }
}
