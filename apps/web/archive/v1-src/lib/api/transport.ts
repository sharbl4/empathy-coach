import type { api, RequestFor } from '@between/contracts';

export type RouteKey = keyof typeof api;
export type Query = Record<string, string | number | undefined>;

export interface CallOptions<K extends RouteKey> {
  /** Path param for `:id` routes. */
  id?: string;
  body?: RequestFor<K>;
  query?: Query;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/**
 * Swappable transport. Returns raw JSON (or null for 204); the client validates
 * every response with the contract schema, so both transports are checked the same way.
 * Errors are thrown as ApiFailure.
 */
export interface ApiTransport {
  readonly kind: 'http' | 'fixtures';
  request<K extends RouteKey>(key: K, options: CallOptions<K>): Promise<unknown>;
}
