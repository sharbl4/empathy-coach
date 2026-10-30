# Backend handoff — stage 1

Base: `76ed3de8ad2533b2115d8a97c87a39c47887430e`.

Contract/SQL review: existing DTOs, pg 8.16.3, Supabase 2.76.1 and explicit roleplay retry semantics are suitable for day 1. No shared contract changes requested. Composite owner FKs and one-pending partial unique index enforce storage invariants. No dependency or lockfile changes.

Implemented: checksum migration history, advisory lock, transactional SQL; private app schema; profile; session CRUD/search/cursor; owner checks; expectedRevision; pending mutation conflicts; bulk learning-data deletion. Auth uses Supabase getUser, fails closed, and accepts injected verifiers only under NODE_ENV=test. Unknown body fields are rejected by shared contracts.

## Checks

```
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run db:migrate
```

Database integration is opt-in and skips explicitly when TEST_DATABASE_URL is absent. Use a separate database whose name contains `test`, distinct from DATABASE_URL, with NODE_ENV=test. It applies migrations twice and checks two owners, concurrent revision updates, cursor isolation, persistence over a new connection, owner FK enforcement, pending conflicts and cascade deletion. It never seeds production.

## Access required

Set secrets locally in the ignored root `.env` or hosting environment. Do not paste values into chat or PRs.

- DATABASE_URL: server-only PostgreSQL role with migration/schema permissions; TEST_DATABASE_URL: separate disposable database for integration checks.
- SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY: project Auth endpoint and public key. Browser settings are Danya's zone; mail/redirect configuration is Anton's zone.
- GIGACHAT_CREDENTIALS: API Authorization Key, GIGACHAT_SCOPE, GIGACHAT_MODEL, GIGACHAT_BASE_URL: versioned API endpoint. API quota/model entitlement must be confirmed against the account.
- Hosting: persistent single backend process, outbound Auth/OAuth/model access and trusted TLS CA. Staging and deployment belong to Anton.

Verified locally on PostgreSQL 17.6: migrations apply and reapply safely; real DB suite checks owner isolation, concurrent revision conflict, cursor/search, reconnect persistence, pending conflicts, owner FKs, ApiError envelopes and cascade deletion. After incorporating Anton's root checks, `npm test` with NODE_ENV=test and TEST_DATABASE_URL: 13 passed, 0 skipped. Typecheck, lint and production build passed. Foundation CI passed on the initial stage-1 commit; it is not a full v1 gate.

Stage 1 capabilities advertise only analysis; reply, exercise and roleplay are false until implemented. Live Auth/model availability requires actual environments; tests do not establish staging readiness.

## Stage 2 — runs and GigaChat

Stacked on the storage PR. Implements POST analyze (202), GET run, restored session results, owner/revision checks, hashed idempotency, one pending operation per session, global and per-user admission limits, one generation per run, deadline enforcement, startup RUN_INTERRUPTED and late-output protection. A session-level PostgreSQL advisory lease prevents concurrent backend processes. Generation happens outside SQL transactions. Failed persistence never replays the external generation; pending recovery requires backend restart.

Defaults: AI_MAX_CONCURRENCY=2, AI_MAX_PER_USER=1, generation deadline 30s. Tune limits to the real account quota. Only the live gigachat mode is supported here; fixtures and injected Auth/model adapters are test-only. Startup requires migrations to have been applied explicitly, as specified by the release procedure.

GigaChat uses direct REST v1, cached OAuth tokens with one refresh in flight, strict response_format.schema from contracts and server-side Zod/evidence validation. The versioned GIGACHAT_BASE_URL must end in /v1, for example https://api.giga.chat/v1. No TLS bypass, redirects with credentials, automatic generation retry or live-error fixture fallback.

After build, run the access check from the real hosting environment:

```
node --env-file-if-exists=.env apps/api/dist/ai/probe.js
node --env-file-if-exists=.env apps/api/dist/ai/probe.js --analyze
node --env-file-if-exists=.env apps/api/dist/auth/probe.js
```

The first command checks OAuth, configured model and token-package balance; pay-as-you-go balance returns manual-check-required. Confirm budget and account quotas manually. The explicit --analyze flag makes one model call with synthetic text and validates it without printing content. Auth probe checks public settings; positive getUser additionally needs SUPABASE_TEST_ACCESS_TOKEN from a signed-in test account in the ignored env. It never prints the user or token or triggers emails. Registration/confirmation/recovery still need separate checks. Locally probes are blocked by absent configuration; no live-service success is claimed.

After incorporating Anton's integration changes: 18 tests pass on PostgreSQL with no skips, including his root service/checkpoint checks. Lint, typecheck and production build pass. Built CLI migration reapplication and runtime live/ready 200, unauthenticated me 401 and JSON 404 were checked. A second empty test DB with preexisting anon/authenticated roles and unsafe default grants was migrated; both roles had no schema USAGE or SELECT on sessions/migration history.

For Anton (CI owner): CI now migrates TEST_DATABASE_URL and runs DB tests, which resolves the storage gate. E2E/server/container still use the distinct DATABASE_URL database, which is not migrated. After the existing migration block add `npm run db:migrate` with the job's DATABASE_URL before E2E/runtime/container startup. Migration files must remain an explicit release step; do not silently auto-create schema on app startup. Real live Auth/GigaChat checks remain separate. Do not expose production secrets to test adapters.

References: [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [GigaChat structured output](https://developers.sber.ru/docs/ru/gigachat/guides/structured-output), [OAuth](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-token), [balance](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/get-balance).
