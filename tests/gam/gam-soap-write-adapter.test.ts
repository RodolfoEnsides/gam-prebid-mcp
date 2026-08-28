import { describe, expect, it } from 'vitest';

import { GamSoapAdapter } from '../../src/gam/adapters/gam-soap-adapter.js';
import type { GamAuthProvider } from '../../src/gam/auth/auth-provider.js';
import type { HttpClient, HttpRequest, HttpResponse } from '../../src/gam/clients/http-client.js';
import { noopLogger } from '../helpers.js';

const auth: GamAuthProvider = {
  authenticate: async () => undefined,
  getAccessToken: async () => 'test-token',
};

describe('GamSoapAdapter writes', () => {
  it('serializes a typed Creative safely without a generic mutation method', async () => {
    const requests: HttpRequest[] = [];
    const http: HttpClient = {
      request: async (_url, request) => {
        requests.push(request);
        return response(
          'createCreatives',
          '<rval xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="ThirdPartyCreative"><id>400</id><name>PUC</name></rval>',
        );
      },
    };
    const adapter = soap(http, 0);

    const result = await adapter.mutate({
      service: 'CreativeService',
      method: 'createCreatives',
      parameter: 'creatives',
      values: [
        {
          __type: 'ThirdPartyCreative',
          advertiserId: '900',
          name: 'PUC',
          snippet: '<script>safe & explicit</script>',
        },
      ],
      retrySafe: false,
    });

    expect(result).toHaveLength(1);
    expect(requests[0]?.body).toContain('<gam:createCreatives>');
    expect(requests[0]?.body).toContain('xsi:type="gam:ThirdPartyCreative"');
    expect(requests[0]?.body).toContain('&lt;script&gt;safe &amp; explicit&lt;/script&gt;');
    expect(requests[0]?.body).not.toContain('test-token');
  });

  it('retries transient idempotent updates', async () => {
    let calls = 0;
    const http: HttpClient = {
      request: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            ok: false,
            status: 503,
            headers: new Headers({ 'retry-after': '0' }),
            json: async () => ({}),
            text: async () => 'unavailable',
          };
        }
        return response('updateOrders', '<rval><id>100</id><name>Updated</name></rval>');
      },
    };
    const adapter = soap(http, 1);

    await adapter.mutate({
      service: 'OrderService',
      method: 'updateOrders',
      parameter: 'orders',
      values: [{ id: '100', name: 'Updated' }],
      retrySafe: true,
    });

    expect(calls).toBe(2);
  });

  it('does not automatically retry non-idempotent creates', async () => {
    let calls = 0;
    const http: HttpClient = {
      request: async () => {
        calls += 1;
        return {
          ok: false,
          status: 503,
          headers: new Headers(),
          json: async () => ({}),
          text: async () => 'unavailable',
        };
      },
    };
    const adapter = soap(http, 3);

    await expect(
      adapter.mutate({
        service: 'OrderService',
        method: 'createOrders',
        parameter: 'orders',
        values: [{ name: 'No duplicate retry' }],
        retrySafe: false,
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

function soap(http: HttpClient, maxRetries: number) {
  return new GamSoapAdapter(auth, http, noopLogger, {
    networkCode: '12345678',
    apiVersion: 'v202608',
    applicationName: 'test',
    timeoutMs: 1_000,
    maxRetries,
    pageSize: 50,
  });
}

function response(method: string, rval: string): HttpResponse {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({}),
    text: async () => `<?xml version="1.0"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
        <soapenv:Body><${method}Response>${rval}</${method}Response></soapenv:Body>
      </soapenv:Envelope>`,
  };
}
