import { describe, expect, it } from 'vitest';

import { RequestTimeoutError } from '../../src/gam/adapters/errors.js';
import { GamRestAdapter } from '../../src/gam/adapters/gam-rest-adapter.js';
import type { GamAuthProvider } from '../../src/gam/auth/auth-provider.js';
import type { HttpClient, HttpRequest, HttpResponse } from '../../src/gam/clients/http-client.js';
import { noopLogger } from '../helpers.js';

const auth: GamAuthProvider = {
  authenticate: async () => undefined,
  getAccessToken: async () => 'not-a-real-token',
};

describe('GamRestAdapter', () => {
  it('normalizes an API error without exposing its response body', async () => {
    const response: HttpResponse = {
      ok: false,
      status: 403,
      headers: new Headers(),
      json: async () => ({ error: { status: 'PERMISSION_DENIED', message: 'sensitive' } }),
      text: async () => 'sensitive',
    };
    const http: HttpClient = { request: async () => response };
    const adapter = new GamRestAdapter(auth, http, noopLogger, {
      timeoutMs: 100,
      maxRetries: 0,
    });

    await expect(adapter.getNetwork('12345678')).rejects.toMatchObject({
      status: 403,
      apiCode: 'PERMISSION_DENIED',
      message: 'GAM API request failed with HTTP 403.',
    });
  });

  it('aborts a request that exceeds its timeout', async () => {
    const http: HttpClient = {
      request: async (_url: string, request: HttpRequest) =>
        new Promise<HttpResponse>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    };
    const adapter = new GamRestAdapter(auth, http, noopLogger, {
      timeoutMs: 10,
      maxRetries: 0,
    });

    await expect(adapter.getNetwork('12345678')).rejects.toBeInstanceOf(RequestTimeoutError);
  });

  it('automatically paginates list resources up to the configured limit', async () => {
    const responses: HttpResponse[] = [
      {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ orders: [{ id: '1' }, { id: '2' }], nextPageToken: 'next' }),
        text: async () => '',
      },
      {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ orders: [{ id: '3' }] }),
        text: async () => '',
      },
    ];
    const requestedUrls: string[] = [];
    const http: HttpClient = {
      request: async (url) => {
        requestedUrls.push(url);
        const response = responses.shift();
        if (!response) throw new Error('unexpected request');
        return response;
      },
    };
    const adapter = new GamRestAdapter(auth, http, noopLogger, {
      timeoutMs: 100,
      maxRetries: 0,
    });

    const result = await adapter.list({
      path: '/networks/123/orders',
      collection: 'orders',
      normalize: (value) => value,
      limit: 3,
      pageSize: 2,
    });

    expect(result.items).toHaveLength(3);
    expect(requestedUrls[1]).toContain('pageToken=next');
    expect(result.truncated).toBe(false);
  });
});
