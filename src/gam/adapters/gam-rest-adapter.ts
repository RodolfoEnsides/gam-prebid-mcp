import type { Logger } from '../../logging/logger.js';
import type { GamAuthProvider } from '../auth/auth-provider.js';
import type { HttpClient, HttpResponse } from '../clients/http-client.js';
import { gamNetworkSchema, type GamNetwork } from '../models/network.js';
import { withRetry } from '../../utils/retry.js';
import type { ListResult } from '../models/resources.js';
import { GamApiError, isTransientGamError, RequestTimeoutError } from './errors.js';
import type { GamNetworkReader } from './gam-adapter.js';

type RestAdapterOptions = {
  baseUrl?: string;
  timeoutMs: number;
  maxRetries: number;
};

export class GamRestAdapter implements GamNetworkReader {
  readonly kind = 'rest' as const;
  private readonly baseUrl: string;

  constructor(
    private readonly auth: GamAuthProvider,
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly options: RestAdapterOptions,
  ) {
    this.baseUrl = (options.baseUrl ?? 'https://admanager.googleapis.com/v1').replace(/\/$/, '');
  }

  async getNetwork(networkCode: string): Promise<GamNetwork> {
    const data = await this.getJson(`/networks/${encodeURIComponent(networkCode)}`);
    return gamNetworkSchema.parse(data);
  }

  async get<T>(path: string, normalize: (value: unknown) => T): Promise<T> {
    return normalize(await this.getJson(path));
  }

  async list<T>(request: {
    path: string;
    collection: string;
    normalize: (value: unknown) => T;
    limit: number;
    pageSize: number;
    pageToken?: string | undefined;
    filter?: string | undefined;
    orderBy?: string | undefined;
  }): Promise<ListResult<T>> {
    const items: T[] = [];
    let pageToken = request.pageToken;

    while (items.length < request.limit) {
      const parameters = new URLSearchParams({
        pageSize: String(Math.min(request.pageSize, request.limit - items.length, 1_000)),
      });
      if (pageToken) parameters.set('pageToken', pageToken);
      if (request.filter) parameters.set('filter', request.filter);
      if (request.orderBy) parameters.set('orderBy', request.orderBy);
      const body = (await this.getJson(`${request.path}?${parameters.toString()}`)) as Record<
        string,
        unknown
      >;
      const pageItems = body[request.collection];
      if (pageItems !== undefined && !Array.isArray(pageItems)) {
        throw new GamApiError('GAM API returned an invalid collection.', 502);
      }
      items.push(...((pageItems ?? []) as unknown[]).map(request.normalize));
      pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : undefined;
      if (!pageToken) break;
    }

    return {
      items: items.slice(0, request.limit),
      count: Math.min(items.length, request.limit),
      limit: request.limit,
      truncated: Boolean(pageToken) || items.length > request.limit,
      ...(pageToken ? { nextPageToken: pageToken } : {}),
      warnings: pageToken ? [`Result limited to ${request.limit} resources.`] : [],
    };
  }

  private async getJson(path: string): Promise<unknown> {
    return withRetry(
      async () => {
        const token = await this.auth.getAccessToken();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
        try {
          const response = await this.http.request(`${this.baseUrl}${path}`, {
            method: 'GET',
            headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
            signal: controller.signal,
          });
          if (!response.ok) throw await this.toApiError(response);
          return await response.json();
        } catch (error) {
          if (controller.signal.aborted) throw new RequestTimeoutError(this.options.timeoutMs);
          throw error;
        } finally {
          clearTimeout(timeout);
        }
      },
      {
        maxRetries: this.options.maxRetries,
        isTransient: isTransientGamError,
        retryAfterMs: (error) => (error instanceof GamApiError ? error.retryAfterMs : undefined),
        onRetry: (error, attempt, delayMs) =>
          this.logger.warn('Retrying transient GAM REST request.', {
            attempt,
            delayMs,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          }),
      },
    );
  }

  private async toApiError(response: HttpResponse): Promise<GamApiError> {
    let apiCode: string | undefined;
    try {
      const body = (await response.json()) as { error?: { status?: unknown } };
      if (typeof body.error?.status === 'string') apiCode = body.error.status;
    } catch {
      // The response body is deliberately not exposed because it may contain sensitive details.
    }
    const retryAfter = response.headers.get('retry-after');
    const retryAfterMs = retryAfter ? parseRetryAfter(retryAfter) : undefined;
    return new GamApiError(
      `GAM API request failed with HTTP ${response.status}.`,
      response.status,
      {
        ...(apiCode ? { apiCode } : {}),
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      },
    );
  }
}

function parseRetryAfter(value: string): number | undefined {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - Date.now());
}
