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
