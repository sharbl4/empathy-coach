# Domain implementation for plan v4

Branch is based on integration ed727847 / shared @between/contracts/domain 1.0.0. createDomain is implemented without import-time work or Fastify/Supabase/GigaChat in its runtime graph. Only apps/api and new migrations are changed. Plan v4 (web + Telegram) supersedes the Telegram-only root documents; root/contracts/transport updates belong to Anton/Danya.

Implemented: domain-issued frozen contexts with issuer checks and live account authorization; UUID accounts with unique Telegram BIGINT; consent/email gates; HMAC email codes (10m, five attempts, resend >=60s and per-account/address hourly caps); TLS/STARTTLS SMTP adapter; persisted dialogue; scoped transactional write idempotency and content-free deletion tombstones; durable inbox/cursor, per-user update slot and shutdown/poller lease; PostgreSQL queue, one active model call and retained execution permits; persistent result outbox/backoff; old learning services and say-direct adaptation. Registration and account deletion never link accounts by matching email.

Internal WebSessions storage implements hash-only short-lived login links, non-consuming inspection, atomic redemption, rotating seven-day server sessions, Secure/HttpOnly/SameSite cookies, origin/CSRF checks, logout and revoke-all. Issued web contexts recheck the associated session. This class is not a public HTTP/facade API yet.

LocalLlmProvider only uses the configured private endpoint, one generation per run, bounded request/response/context, explicit thinking-disable fields, reasoning/partial/invalid JSON rejection and shared evidence validation. JSON-schema requests are opt-in only after the inference-server capability is measured. Default input budgeting uses a conservative UTF-8 upper bound; no input is silently truncated. No real GPU, SMTP or Telegram calls were made by the new tests.

## Required contract/integration work (not implemented or claimed ready)

The currently published PR #18 remains Telegram-only. PR #19 adds the bot against the same domain 1.0.0 contract and reports the same missing v4 interfaces; neither publishes A1's web+Telegram revision. A1 must publish that revision before the public two-interface implementation can be completed:

- Login-link/session methods, HTTP routes/CSRF DTOs, web-issued principal/context and explicit app/worker lifecycle. Fastify/web are still archived by the integration root; I did not change those files.
- Server-owned privacy preview/confirmation DTO and methods (revision/hash and every outgoing field, including drafts, exercise answers and role turns). The domain currently refuses AI without a matching confirmation record. Tests seed such records directly only in the isolated test DB; no production bypass exists. The v1 createSession method masks email/phone but is not the complete v4 preview/history flow.
- Registration recovery DTO: active email challenge ID/expiry/resend state are not readable after bot restart through current Account/Dialogue DTOs. The code/challenge remain durable internally, but that transport recovery boundary needs a contract.
- Durable typed update payload/recovery policy if accepted inputs must remain replayable beyond Telegram redelivery. Current inbox stores identity HMAC, receipt and stable intent, no raw updates; offset stays behind unfinished entries.
- DTOs/catalogues for evidence categories/comparison, direct/draft-only input, three difficulties, four contexts/transcripts, daily practice/reminders, rubric assessments, cards, before/after tests, usefulness and allowed analytics/policy actions. B3 expansion is not implemented by this branch.

No shared schemas were copied or changed to guess those interfaces. Existing v1 learning can be adapted through the shared facade; it does not prove all v4 requirements or the full browser/bot product.

## New checks

Use a dedicated local TEST_DATABASE_URL containing test and distinct from runtime DATABASE_URL, with NODE_ENV=test. Build contracts first:

```
npm run build -w @between/contracts
npm run build -w @between/api
npm run typecheck -w @between/api
node --import tsx --test apps/api/test/domain*.test.ts
node scripts/check-domain-export.mjs
npm run test:legacy
npm run test:contracts
npm run lint
```

The domain suites use real PostgreSQL and explicit test-only mail/model/clock dependencies. They cover forged context, consent/email gating, code expiry/attempt/reissue/concurrent redemption, SMTP failure, idempotent writes/deletion, inbox/FSM restart and TTL, single poller, queue cap/deletion/late output/restart/outbox and web auth storage. `createDomainForTest` is not exported by the package entry and rejects injection outside NODE_ENV=test. API typecheck includes all tests.

Local handoff validation: 34 backend/archived checks passed with zero skips (including 11 new domain/provider/web-storage checks); 15 shared-contract/root checks passed; API build/typecheck, lint and side-effect-free import passed. A separate real PostgreSQL upgrade from applied 001/002 to 003–006 preserved a synthetic legacy profile/session, repeated cleanly and created no implicit Telegram account mapping. The complete root test gate still fails without the bot tests; root build fails without the bot entry from PR #19.

Migrations 003–006 are additive; applied 001/002 are unchanged. Temporary dialogue data expires after one hour; bounded maintenance clears expired drafts/code material, old rate metadata and completed inbox entries after seven days. Completed outbox tombstones stay while their run exists to prevent re-delivery on reconciliation. Data/account deletion removes content from idempotency results; old keys cannot resurrect history. These retention defaults need the lead's final policy review.

Additional internal settings to agree in root env: AI_QUEUE_LIMIT (default10, bounded50), EMAIL_ACCOUNT_HOURLY_LIMIT (5), EMAIL_ADDRESS_HOURLY_LIMIT (10), LOCAL_LLM_JSON_SCHEMA (explicit capability flag, default off), LOCAL_LLM_CONTEXT_TOKENS (4096). DomainOptions and root env files were not changed. EMAIL_CODE_SECRET is server-only; no addresses/codes/cookies/tokens/output are logged.

Full root build/test currently remains blocked by the missing bot entry/tests and pending v4 root/contracts work. Standalone domain/archived checks are not a substitute for those integration gates or real Telegram/SMTP/GPU/web acceptance.

---

# Archived web/GigaChat backend handoff (previous release)

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
