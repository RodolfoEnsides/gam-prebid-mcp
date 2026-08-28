import { describe, expect, it } from 'vitest';

import { GamSoapAdapter } from '../../src/gam/adapters/gam-soap-adapter.js';
import type { GamAuthProvider } from '../../src/gam/auth/auth-provider.js';
import type { HttpClient, HttpRequest, HttpResponse } from '../../src/gam/clients/http-client.js';
import { normalizeCreative } from '../../src/gam/models/normalize.js';
import { noopLogger } from '../helpers.js';

const auth: GamAuthProvider = {
  authenticate: async () => undefined,
  getAccessToken: async () => 'test-token',
};

function soapResponse(id: string, total: number): HttpResponse {
  const xml = `<?xml version="1.0"?>
    <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
      <soapenv:Body>
        <getCreativesByStatementResponse>
          <rval>
            <totalResultSetSize>${total}</totalResultSetSize>
            <results xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="ImageCreative">
              <id>${id}</id><name>Creative ${id}</name><status>ACTIVE</status>
              <size><width>300</width><height>250</height></size>
            </results>
          </rval>
        </getCreativesByStatementResponse>
      </soapenv:Body>
    </soapenv:Envelope>`;
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({}),
    text: async () => xml,
  };
}

describe('GamSoapAdapter', () => {
  it('paginates SOAP reads and only builds get operations', async () => {
    const requests: HttpRequest[] = [];
    const responses = [soapResponse('400', 2), soapResponse('401', 2)];
    const http: HttpClient = {
      request: async (_url, request) => {
        requests.push(request);
        const response = responses.shift();
        if (!response) throw new Error('unexpected request');
        return response;
      },
    };
    const adapter = new GamSoapAdapter(auth, http, noopLogger, {
      networkCode: '12345678',
      apiVersion: 'v202608',
      applicationName: 'test',
      timeoutMs: 100,
      maxRetries: 0,
      pageSize: 1,
    });

    const result = await adapter.listByStatement({
      service: 'CreativeService',
      method: 'getCreativesByStatement',
      limit: 2,
    });

    const creatives = result.items.map((item) => normalizeCreative(item));
    expect(creatives.map((creative) => creative.id)).toEqual(['400', '401']);
    expect(creatives[0]?.type).toBe('ImageCreative');
    expect(requests).toHaveLength(2);
    expect(requests[0]?.body).toContain('getCreativesByStatement');
    expect(requests[0]?.body).toContain('LIMIT 1 OFFSET 0');
    expect(requests[1]?.body).toContain('LIMIT 1 OFFSET 1');
    expect(requests.map((request) => request.body).join('')).not.toMatch(/create|update|delete/i);
  });
});
