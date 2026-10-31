// DEV ONLY. In-memory transport over the shared contract fixtures (VITE_API_MODE=fixtures).
// Loaded through a dynamic import guarded by import.meta.env.DEV, so it never ships in production.
// It does NOT analyse text: every analysis returns the same prepared fixture output.
import { outputFixtures, responseFixtures, runs as fixtureRuns, session as fixtureSession, situations } from '@between/contracts/fixtures';
import type { RequestFor, Run, SessionDetail } from '@between/contracts';
import { ApiFailure } from './errors';
import type { ApiTransport, CallOptions, RouteKey } from './transport';

type Session = Omit<SessionDetail, 'runs' | 'roleplays'>;
type ErrorCode = NonNullable<ApiFailure['code']>;

export const DEV_FAIL_MARKER = '[dev:fail]';
const LATENCY_MS = 300;
const RUN_DURATION_MS = 3000;

const fail = (status: number, code: ErrorCode) => new ApiFailure('http', status, code, 'dev-fixture');
const now = () => new Date().toISOString();
const wait = (signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, LATENCY_MS);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new ApiFailure('aborted')); }, { once: true });
});

export function createFixtureTransport(): ApiTransport {
  const sessions = new Map<string, Session>();
  const runs = new Map<string, Run>();
  const idempotency = new Map<string, { runId: string; payload: string }>();

  const seedAnalysis = fixtureRuns.find(run => run.kind === 'analysis') as Run;
  sessions.set(fixtureSession.id, fixtureSession as Session);
  runs.set(seedAnalysis.id, { ...seedAnalysis, sessionId: fixtureSession.id });
  for (const input of situations.slice(1)) {
    const id = crypto.randomUUID();
    sessions.set(id, { ...input, id, revision: 1, createdAt: fixtureSession.createdAt, updatedAt: fixtureSession.updatedAt });
  }

  const owned = (id?: string) => { const found = id && sessions.get(id); if (!found) throw fail(404, 'NOT_FOUND'); return found; };
  const sessionRuns = (sessionId: string) => [...runs.values()].filter(run => run.sessionId === sessionId);
  const ordered = () => [...sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));

  function startAnalysis(session: Session): Run {
    const run: Run = { id: crypto.randomUUID(), sessionId: session.id, revision: session.revision, kind: 'analysis', status: 'pending', output: null, errorCode: null, createdAt: now(), updatedAt: now() };
    runs.set(run.id, run);
    setTimeout(() => {
      const current = runs.get(run.id);
      if (!current || current.status !== 'pending' || !sessions.has(session.id)) return;
      runs.set(run.id, session.situation.message.includes(DEV_FAIL_MARKER)
        ? { ...run, status: 'failed', errorCode: 'MODEL_TIMEOUT', updatedAt: now() }
        : { ...run, status: 'succeeded', output: outputFixtures.analysis, updatedAt: now() } as Run);
    }, RUN_DURATION_MS);
    return run;
  }

  const handlers: { [K in RouteKey]?: (options: CallOptions<K>) => unknown } = {
    live: () => ({ status: 'ok' }),
    ready: () => ({ status: 'ok' }),
    // aiMode is reported as mock: nothing here comes from a model.
    me: () => ({ ...(responseFixtures.me as object), aiMode: 'mock' }),
    updateMe: ({ body }) => ({ ...(responseFixtures.me as object), aiMode: 'mock', ...(body?.displayName ? { displayName: body.displayName } : {}), ...(body?.onboardingCompleted ? { onboardingCompletedAt: now() } : {}) }),
    sessions: ({ query }) => {
      const q = String(query?.q ?? '').toLowerCase();
      const limit = Number(query?.limit ?? 20);
      const start = query?.cursor ? Number(atob(String(query.cursor))) : 0;
      const all = ordered().filter(session => !q || session.title.toLowerCase().includes(q));
      const items = all.slice(start, start + limit);
      return { items, nextCursor: start + limit < all.length ? btoa(String(start + limit)) : null };
    },
    session: ({ id }) => {
      const session = owned(id);
      return { ...session, runs: sessionRuns(session.id), roleplays: [] };
    },
    createSession: ({ body }) => {
      const input = body as RequestFor<'createSession'>;
      const session: Session = { ...input, id: crypto.randomUUID(), revision: 1, createdAt: now(), updatedAt: now() };
      sessions.set(session.id, session);
      return session;
    },
    updateSession: ({ id, body }) => {
      const session = owned(id);
      const { expectedRevision, ...input } = body as RequestFor<'updateSession'>;
      if (expectedRevision !== session.revision) throw fail(409, 'REVISION_CONFLICT');
      if (sessionRuns(session.id).some(run => run.status === 'pending')) throw fail(409, 'OPERATION_IN_PROGRESS');
      const next = { ...session, ...input, revision: session.revision + 1, updatedAt: now() };
      sessions.set(next.id, next);
      return next;
    },
    deleteSession: ({ id }) => {
      const session = owned(id);
      if (sessionRuns(session.id).some(run => run.status === 'pending')) throw fail(409, 'OPERATION_IN_PROGRESS');
      sessions.delete(session.id);
      for (const run of sessionRuns(session.id)) runs.delete(run.id);
      return null;
    },
    analyze: ({ id, body, idempotencyKey }) => {
      const session = owned(id);
      const payload = JSON.stringify({ id, body });
      if (!idempotencyKey) throw fail(400, 'VALIDATION_ERROR');
      const previous = idempotency.get(idempotencyKey);
      if (previous) { if (previous.payload !== payload) throw fail(409, 'IDEMPOTENCY_CONFLICT'); return { runId: previous.runId }; }
      if (body?.expectedRevision !== session.revision) throw fail(409, 'REVISION_CONFLICT');
      if (sessionRuns(session.id).some(run => run.status === 'pending')) throw fail(409, 'OPERATION_IN_PROGRESS');
      const run = startAnalysis(session);
      idempotency.set(idempotencyKey, { runId: run.id, payload });
      return { runId: run.id };
    },
    run: ({ id }) => { const run = id && runs.get(id); if (!run) throw fail(404, 'NOT_FOUND'); return run; },
    progress: () => {
      const analyzed = new Set([...runs.values()].filter(run => run.kind === 'analysis' && run.status === 'succeeded').map(run => run.sessionId));
      return { analyzedSessions: analyzed.size, completedExercises: 0, completedRoleplays: 0, skills: [], latestTip: analyzed.size ? outputFixtures.analysis.skillTip : null };
    },
  };

  return {
    kind: 'fixtures',
    async request(key, options) {
      await wait(options.signal);
      const handler = handlers[key] as ((options: CallOptions<typeof key>) => unknown) | undefined;
      // Later learning endpoints arrive with the day-2 UI; until then they are explicitly absent here.
      if (!handler) throw fail(404, 'NOT_FOUND');
      return structuredClone(handler(options));
    },
  };
}
