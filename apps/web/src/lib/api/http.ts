import { api, ApiError } from '@between/contracts';
import { ApiFailure } from './errors';
import type { ApiTransport, CallOptions, RouteKey } from './transport';

const TIMEOUT_MS = 20_000;

export interface TokenSource {
  accessToken(): Promise<string | null>;
  refresh(): Promise<string | null>;
  /** Called when the server still rejects the token after one refresh. */
  onUnauthorized(): void;
}

function buildUrl(key: RouteKey, options: CallOptions<RouteKey>) {
  let path: string = api[key].path;
  if (path.includes(':id')) {
    if (!options.id) throw new ApiFailure('invalid-request');
    path = path.replace(':id', encodeURIComponent(options.id));
  }
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(options.query ?? {})) if (value !== undefined && value !== '') params.set(name, String(value));
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export function createHttpTransport(tokens: TokenSource): ApiTransport {
  async function send<K extends RouteKey>(key: K, options: CallOptions<K>, token: string | null): Promise<Response> {
    const route = api[key];
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    let body: string | undefined;
    if ('body' in route) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(options.body ?? {}); }
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
      return await fetch(buildUrl(key, options as CallOptions<RouteKey>), { method: route.method, headers, body, signal, credentials: 'same-origin' });
    } catch {
      if (options.signal?.aborted) throw new ApiFailure('aborted');
      if (timeout.aborted) throw new ApiFailure('timeout');
      throw new ApiFailure('network');
    }
  }

  async function readJson(response: Response): Promise<unknown> {
    if (response.status === 204) return null;
    try { return await response.json(); } catch { throw new ApiFailure('invalid-response', response.status); }
  }

  return {
    kind: 'http',
    async request(key, options) {
      let response = await send(key, options, await tokens.accessToken());
      if (response.status === 401) {
        const fresh = await tokens.refresh();
        if (fresh) response = await send(key, options, fresh);
      }
      if (response.ok) return readJson(response);
      const parsed = ApiError.safeParse(await readJson(response).catch(() => null));
      if (response.status === 401) tokens.onUnauthorized();
      if (!parsed.success) throw new ApiFailure('http', response.status, response.status === 401 ? 'UNAUTHORIZED' : undefined);
      const { code, requestId } = parsed.data.error;
      // Server messages are safe Russian text by contract, but the UI keeps its own wording per code.
      throw new ApiFailure('http', response.status, code, requestId);
    },
  };
}
