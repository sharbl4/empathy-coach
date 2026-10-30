import { api, type RequestFor, type ResponseFor } from '@between/contracts';
import { ApiFailure } from './errors';
import type { ApiTransport, CallOptions, RouteKey } from './transport';

export type Me = ResponseFor<'me'>;
export type Session = ResponseFor<'createSession'>;
export type SessionPage = ResponseFor<'sessions'>;
export type SessionDetail = ResponseFor<'session'>;
export type Progress = ResponseFor<'progress'>;
export type RunAccepted = ResponseFor<'analyze'>;
export type { Run, SessionInput } from '@between/contracts';

export function createApiClient(transport: ApiTransport) {
  async function call<K extends RouteKey>(key: K, options: CallOptions<K> = {}): Promise<ResponseFor<K>> {
    const route = api[key];
    if ('body' in route && !route.body.safeParse(options.body ?? {}).success) throw new ApiFailure('invalid-request');
    const raw = await transport.request(key, options);
    const parsed = route.response.safeParse(raw);
    if (!parsed.success) throw new ApiFailure('invalid-response');
    return parsed.data as ResponseFor<K>;
  }

  return {
    transport: transport.kind,
    me: (signal?: AbortSignal) => call('me', { signal }),
    updateMe: (body: RequestFor<'updateMe'>) => call('updateMe', { body }),
    sessions: (query: { q?: string; cursor?: string; limit?: number }, signal?: AbortSignal) => call('sessions', { query, signal }),
    session: (id: string, signal?: AbortSignal) => call('session', { id, signal }),
    createSession: (body: RequestFor<'createSession'>) => call('createSession', { body }),
    updateSession: (id: string, body: RequestFor<'updateSession'>) => call('updateSession', { id, body }),
    deleteSession: (id: string) => call('deleteSession', { id }),
    analyze: (id: string, expectedRevision: number, idempotencyKey: string) =>
      call('analyze', { id, body: { expectedRevision }, idempotencyKey }),
    run: (id: string, signal?: AbortSignal) => call('run', { id, signal }),
    progress: (signal?: AbortSignal) => call('progress', { signal }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
