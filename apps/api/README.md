# Backend handoff

API implements shared contracts 0.1.0: Supabase getUser, profile, saved-session CRUD/search/cursor, analysis, reply feedback/examples, exercise/feedback, roleplay start/turn/finish/retry, progress and learning-data deletion. All capabilities are advertised as implemented. Root dependencies, lockfile and shared contracts are unchanged.

## Storage and execution

PostgreSQL is the persistent source of truth. Apply migrations explicitly before starting the backend:

```
npm ci
npm run build
npm run db:migrate
npm start
```

Migration history uses checksums, a PostgreSQL advisory lock and transactions. Applied SQL is immutable. Migration 001 creates the private app schema and owner FKs; 002 adds roleplay's current-run FK and one-active-role-per-revision index. app must not be exposed through Supabase Data API. Use a direct/session PostgreSQL connection, not a transaction pooler, for session advisory locks.

Only one backend process can hold the worker lease. Tasks are admitted immediately with no unbounded queue. Defaults: AI_MAX_CONCURRENCY=2, AI_MAX_PER_USER=1, deadline 30s. Tune limits to the account quota. Execution permits survive deletion and deadlines until the underlying provider promise settles. Bulk deletion signals cancellation only for deleted run IDs. External generation is outside SQL transactions and is never automatically retried.

Pending runs interrupted by restart become failed/RUN_INTERRUPTED. Failed persistence does not replay generation; a pending run with an uncertain database write is recovered on restart. Completion rechecks owner, revision, current roleplay operation and session existence. Late output cannot restore deleted data.

## Learning behavior

Every learning action requires a successful analysis of the current revision. Four reply examples are available without a draft. Draft quotes must occur in the actual draft; analysis quotes must occur in the message. Exercise feedback references a successful exercise of the same owner/session/revision.

Roleplay stores/counts user turns on the server. Turn insertion and run creation are transactional. The third user turn produces final feedback, never a fourth counterpart reply. Early finish is allowed after one saved user answer, including a failed counterpart generation; it supersedes that failed turn. Other failed roleplay operations use POST /api/runs/:id/retry with a new key. Retry uses the persisted context and never appends the user message again. A superseded failure cannot be retried. A fresh normal turn cannot bypass a failed turn; a failed third-turn result uses retry.

All AI actions use an Idempotency-Key UUID. The hash includes method, resource and canonical body. Duplicate intent returns the existing run; changed payload with the same key conflicts. A session has at most one pending task. Editing/removing a pending session conflicts; confirmed bulk deletion cancels pending work. History/details return recent results of the current revision. Progress counts unique completed exercises/roles and distinct analyzed sessions; cascade deletion updates counts and removes the latest tip.

## Checks without keys

```
npm run typecheck
npm run lint
npm test
npm run build
```

Typecheck includes src and API tests. DB tests require NODE_ENV=test and TEST_DATABASE_URL for a separate database whose name contains test and whose URL differs from DATABASE_URL. They skip explicitly without this setup; CI requires the separate DB. Never seed or run integration tests against production. Auth/model injection is rejected outside NODE_ENV=test; production never falls back to fixtures.

Verified locally on PostgreSQL 17.6: repeatable migrations, two owners, revision/idempotency conflicts, cursor isolation, reconnect persistence, pending recovery, actual execution caps through deletion/timeout, full learning HTTP flow, third-turn/early finalization, failed start/turn/finish retries, concurrency conflicts, source-reference ownership and deletion. Low-privilege anon/authenticated roles were checked on another empty test DB with unsafe default grants: no schema USAGE or SELECT on sessions/migration history. Exact latest test/CI counts are reported in the PR.

## Evaluation catalogue

Ten scenarios cover neutrality, ambiguity, support, conflict, boundaries, missing context, aggression, prompt injection, a bad draft and a constructive reply. Expectations concern response properties rather than labelled true emotions. Inspect the catalogue without any API calls:

```
node apps/api/dist/ai/eval-runner.js
```

The optional --live flag makes up to 12 generations, without retries. It is a separate manual step after credentials/budget setup. Schema/evidence checks do not establish semantic quality; the listed semantic criteria require human review. No live calls were made during this key-free implementation.

## Access and remaining release gates

Set values only in ignored .env or hosting secrets; do not paste them into chat/PRs/logs.

- DATABASE_URL: server-only PostgreSQL connection; TEST_DATABASE_URL: separate disposable DB.
- SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY: Auth project settings; browser/redirect/mail setup belongs to Danya/Anton.
- GIGACHAT_CREDENTIALS: API Authorization Key, GIGACHAT_SCOPE, GIGACHAT_MODEL, GIGACHAT_BASE_URL (REST v1, e.g. https://api.giga.chat/v1). API model entitlement and budget need account confirmation.
- Hosting: persistent backend, trusted TLS, outbound Auth/OAuth/model access. Deployment and CI belong to Anton; web integration belongs to Danya.

After key setup, use the access probes; --analyze explicitly invokes one live analysis:

```
node --env-file-if-exists=.env apps/api/dist/auth/probe.js
node --env-file-if-exists=.env apps/api/dist/ai/probe.js
node --env-file-if-exists=.env apps/api/dist/ai/probe.js --analyze
```

Positive getUser additionally needs SUPABASE_TEST_ACCESS_TOKEN from a signed-in test user in env. Probes print statuses only, not users, tokens, correspondence or model output. Pay-as-you-go balance needs manual account verification. Live Auth/GigaChat, external email delivery, complete browser integration and hosting/TLS remain release gates. CI now migrates both runtime and separate test DBs after Anton's changes.

References: [getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [GigaChat structured output](https://developers.sber.ru/docs/ru/gigachat/guides/structured-output), [OAuth](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-token), [balance](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/get-balance).
