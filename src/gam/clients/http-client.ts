export interface HttpResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type HttpRequest = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export interface HttpClient {
  request(url: string, request: HttpRequest): Promise<HttpResponse>;
}

export class FetchHttpClient implements HttpClient {
  async request(url: string, request: HttpRequest): Promise<HttpResponse> {
    return fetch(url, request);
  }
}
