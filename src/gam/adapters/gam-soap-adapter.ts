import { XMLParser } from 'fast-xml-parser';

import type { Logger } from '../../logging/logger.js';
import { withRetry } from '../../utils/retry.js';
import type { GamAuthProvider } from '../auth/auth-provider.js';
import type { HttpClient, HttpResponse } from '../clients/http-client.js';
import { asArray, asRecord } from '../models/normalize.js';
import type { ListResult } from '../models/resources.js';
import { GamApiError, isTransientGamError, RequestTimeoutError } from './errors.js';
import type { GamAdapter } from './gam-adapter.js';

type SoapService =
  'OrderService' | 'LineItemService' | 'CreativeService' | 'LineItemCreativeAssociationService';

type SoapGetMethod =
  | 'getOrdersByStatement'
  | 'getLineItemsByStatement'
  | 'getCreativesByStatement'
  | 'getLineItemCreativeAssociationsByStatement';

type SoapMutationMethod =
  | 'createOrders'
  | 'updateOrders'
  | 'createLineItems'
  | 'updateLineItems'
  | 'createCreatives'
  | 'updateCreatives'
  | 'createLineItemCreativeAssociations';

/** SOAP boundary retained for write operations and resources without equivalent REST coverage. */
export class GamSoapAdapter implements GamAdapter {
  readonly kind = 'soap' as const;
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  });

  constructor(
    private readonly auth: GamAuthProvider,
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly options: {
      networkCode: string;
      apiVersion: string;
      applicationName: string;
      timeoutMs: number;
      maxRetries: number;
      pageSize: number;
      baseUrl?: string;
    },
  ) {}

  async listByStatement(request: {
    service: SoapService;
    method: SoapGetMethod;
    where?: string | undefined;
    limit: number;
    offset?: number | undefined;
  }): Promise<ListResult<unknown>> {
    const items: unknown[] = [];
    let offset = request.offset ?? 0;
    let total = Number.POSITIVE_INFINITY;

    while (items.length < request.limit && offset < total) {
      const pageLimit = Math.min(this.options.pageSize, request.limit - items.length);
      const orderField = orderFieldFor(request.service);
      const query = `${request.where ? `WHERE ${request.where} ` : ''}ORDER BY ${orderField} LIMIT ${pageLimit} OFFSET ${offset}`;
      const response = await this.call(
        request.service,
        request.method,
        this.statementBody(query),
        true,
      );
      const rval = asRecord(response);
      const results = asArray(rval.results);
      items.push(...results);
      const parsedTotal = Number(rval.totalResultSetSize);
      total = Number.isFinite(parsedTotal) ? parsedTotal : offset + results.length;
      offset += results.length;
      if (results.length === 0) break;
    }

    const truncated = offset < total;
    return {
      items,
      count: items.length,
      limit: request.limit,
      truncated,
      ...(truncated ? { nextPageToken: String(offset) } : {}),
      warnings: truncated ? [`Result limited to ${request.limit} resources.`] : [],
    };
  }

  async mutate(request: {
    service: SoapService;
    method: SoapMutationMethod;
    parameter: 'orders' | 'lineItems' | 'creatives' | 'lineItemCreativeAssociations';
    values: Array<Record<string, unknown>>;
    retrySafe: boolean;
  }): Promise<unknown[]> {
    if (request.values.length === 0) return [];
    const body = request.values.map((value) => objectElement(request.parameter, value)).join('');
    return asArray(await this.call(request.service, request.method, body, request.retrySafe));
  }

  private async call(
    service: string,
    method: string,
    body: string,
    retrySafe: boolean,
  ): Promise<unknown> {
    return withRetry(
      async () => {
        const token = await this.auth.getAccessToken();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
        try {
          const response = await this.http.request(this.serviceUrl(service), {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              accept: 'text/xml',
              'content-type': 'text/xml; charset=utf-8',
              soapaction: method,
            },
            body: this.envelope(method, body),
            signal: controller.signal,
          });
          if (!response.ok) throw await this.toApiError(response);
          return this.parseResponse(await response.text(), method);
        } catch (error) {
          if (controller.signal.aborted) throw new RequestTimeoutError(this.options.timeoutMs);
          throw error;
        } finally {
          clearTimeout(timeout);
        }
      },
      {
        maxRetries: retrySafe ? this.options.maxRetries : 0,
        isTransient: isTransientGamError,
        retryAfterMs: (error) => (error instanceof GamApiError ? error.retryAfterMs : undefined),
        onRetry: (error, attempt, delayMs) =>
          this.logger.warn('Retrying transient GAM SOAP request.', {
            attempt,
            delayMs,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          }),
      },
    );
  }

  private serviceUrl(service: string): string {
    const baseUrl = this.options.baseUrl ?? 'https://ads.google.com/apis/ads/publisher';
    return `${baseUrl.replace(/\/$/, '')}/${this.options.apiVersion}/${service}`;
  }

  private statementBody(query: string): string {
    return `<gam:filterStatement><gam:query>${escapeXml(query)}</gam:query></gam:filterStatement>`;
  }

  private envelope(method: string, body: string): string {
    const namespace = `https://www.google.com/apis/ads/publisher/${this.options.apiVersion}`;
    return `<?xml version="1.0" encoding="UTF-8"?>\
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:gam="${namespace}">\
<soapenv:Header><gam:RequestHeader><gam:networkCode>${escapeXml(this.options.networkCode)}</gam:networkCode>\
<gam:applicationName>${escapeXml(this.options.applicationName)}</gam:applicationName></gam:RequestHeader></soapenv:Header>\
<soapenv:Body><gam:${method}>${body}</gam:${method}></soapenv:Body></soapenv:Envelope>`;
  }

  private parseResponse(xml: string, method: string): unknown {
    if (/<!DOCTYPE/i.test(xml)) {
      throw new GamApiError('GAM SOAP response contained a forbidden document type.', 502);
    }
    const parsed = asRecord(this.parser.parse(xml));
    const body = asRecord(asRecord(parsed.Envelope).Body);
    const fault = asRecord(body.Fault);
    if (Object.keys(fault).length > 0) {
      throw new GamApiError('GAM SOAP request returned a fault.', 502, {
        apiCode: typeof fault.faultcode === 'string' ? fault.faultcode : 'SOAP_FAULT',
      });
    }
    const response = asRecord(body[`${method}Response`]);
    if (!Object.hasOwn(response, 'rval')) {
      throw new GamApiError('GAM SOAP response was missing its result.', 502);
    }
    return response.rval;
  }

  private async toApiError(response: HttpResponse): Promise<GamApiError> {
    const body = await response.text();
    if (/<(?:\w+:)?Fault[\s>]/i.test(body)) {
      return new GamApiError('GAM SOAP request returned a fault.', 400, {
        apiCode: 'SOAP_FAULT',
      });
    }
    const retryAfter = response.headers.get('retry-after');
    const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
    return new GamApiError(
      `GAM SOAP request failed with HTTP ${response.status}.`,
      response.status,
      {
        ...(Number.isFinite(seconds) && seconds >= 0 ? { retryAfterMs: seconds * 1_000 } : {}),
      },
    );
  }
}

function orderFieldFor(service: SoapService): string {
  switch (service) {
    case 'OrderService':
    case 'LineItemService':
    case 'CreativeService':
      return 'id';
    case 'LineItemCreativeAssociationService':
      return 'lineItemId, creativeId';
  }
}

function objectElement(tag: string, value: Record<string, unknown>): string {
  const type = typeof value.__type === 'string' ? value.__type : undefined;
  const attributes = type ? ` xsi:type="gam:${escapeXml(type)}"` : '';
  const children = Object.entries(value)
    .filter(([key, item]) => key !== '__type' && item !== undefined)
    .map(([key, item]) => valueElement(key, item))
    .join('');
  return `<gam:${tag}${attributes}>${children}</gam:${tag}>`;
}

function valueElement(tag: string, value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => valueElement(tag, item)).join('');
  if (value !== null && typeof value === 'object') {
    return objectElement(tag, value as Record<string, unknown>);
  }
  return `<gam:${tag}>${escapeXml(String(value))}</gam:${tag}>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
