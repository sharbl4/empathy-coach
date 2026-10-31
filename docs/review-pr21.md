# Review PR21 · actual d97ddf1 · 2026-10-31

PR21 DRAFT/OPEN, base feat/web-telegram-integration at f3ebfc0. Commits2f894e6 (bot),d97ddf1b0bc81e469c75c7f0384b1ee36965dd95(web). Fetched source and actual CI, not author's uncommitted stubs. Backend PR20 still f9fc3019276e081937bd3add82ade62801235717, old ed72784 base. No merges/closures/comments/messages were performed.

## Required fixes

1. BLOCKER runtime leak: public /product→/domain loads top-level RuntimeEnvironment schemas; production artifact contains EMAIL_CODE_SECRET/WEB_SESSION_SECRET names. No evidence that secret VALUES were included. Root fix in2.2 moves server validators to /runtime with browser:null; guard retained/strengthened. Independent isolated production build before/after confirmed the cause and fix.
2. BLOCKER bot runtime.ts/flows.ts: unknown errors and INTERNAL_ERROR classified transient; Poller.handle returns false forever, cap only MAX_BACKOFF=60000, no recordUpdateFailure. Negative unit probe called same private update4times:4retryable outcomes,0ack,0failure records, stable receipt intent. This is reproduction of missing bound, not a backend integration test. Use DB attempts/retry_wait/failed, terminal unknown, shared error policy; do not ack uncertain mutations.
3. BLOCKER displayed snapshot: flows.ts confirm fetches current preview and confirms its newest hash. If web edits it after bot display without changing dialogue revision, the old send button can approve an unseen snapshot. applyEdit similarly fetches latest revision and can silently edit newer data. Persist shown preview hash/revision and field target through navigation, compare before confirming/editing; stale→show again, never silently authorize.
4. BLOCKER email/challenge, editable field, speaker, card and assessment answers live in Memo Map. Full step data does not survive restart or transfer to web. Partial assessment is not navigation-only expendable data. Use2.2 canonical navigation/TTL and2.1 emailVerification/resend; remove authoritative Map fields.
5. BLOCKER bot and web support call hardcoded countryCode:'RU'. Language is not country. New persisted supportRegion defaults unknown, support({}) gives no numbers until a verified selected region is available. Add selection/clear UI in both interfaces.
6. Contract mismatch with current2.1 already exists before new2.2: startRun/retry omit snapshotHash; requestEmailCode response treated as legacy challenge; verify result treated as Account; recordUpdateFailure/receipts absent. With full2.2, both bot/web typechecks fail additionally on navigation/expectedDialogueRevision/support({}). Port, do not cast away errors or fill defaults in frontend.
7. Preview budget unknown still enables Send (only too_large disables). Domain must refuse non-fits; UI should disable unknown and explain. Existing safety:support correctly hides generation button in web and bot; keep it.
8. Stable intents: receipt.intentKey is reused in tested simple retry; Flows.key also uses a per-handler seq counter. Must prove all crash points after partial state transitions preserve operation/resource keys, not just one same-code-path fake test. Writes use stable per-intent keys; no fresh key or fresh generation on unknown network result. Test failed persistence/ack and process restarts with real DB.
9. Persistent web continuation is not implemented: composer/card/assessment state is React-local. Port both interfaces, not only bot; reject cross-interface stale revisions and retain confirmed resource references. No localStorage personal content/auth.
10. Real facade/HTTP/browser adapter absent on root and PR21. Whole build, PG integration and Playwright must run after Dima's ports. No stub facade/http or scratch API can satisfy these gates.

## Independently executed

Isolated detached worktree .tools/review-pr21, no .env copied, no backend/HTTP stubs:
- npm ci --offline: success.
- Build contracts then bot committed unit suite:32passed,0failed,0skipped. These are explicit FakeProduct/Telegram tests, not real backend.
- Original npm run build:web: TS+Vite succeed; unchanged release guard FAILS server-env markers.
- Controlled experiment on PR21's own31574f8 DTO base, changing ONLY runtime extraction + runtime package export: production TS/Vite and original guard PASS. The strengthened root import-graph/artifact guard also PASS on this real bundle. This proves runtime-boundary fix, not current2.2 API compatibility.
- Copy current shared2.2 contracts into isolated checkout: bot and web typecheck FAIL (email shapes, hash, dialogue navigation, assessment revision, support); whole root build FAILS absent api facade/http. No API stubs added.
- Root contract/lifecycle tests39passed/0skipped and lint success. They do not verify new DB persistence.
Actual GitHub head d97ddf1: root SUCCESS, web-release FAILURE, domain-bot-web-integration FAILURE. Backend f9fc301: root SUCCESS, integration FAILURE.

## Retained positives and old PRs

Transport now receives domain/lease, no createDomain/main in its source, passive import/construction, fatal401/404/409 stops poller; private sender/inline rejection, plain text/chunking, outbox run|reminder, auth fragment removal before React/explicit exchange, no active Supabase in PR21 src. Useful catalogue/rating/levels/privacy/evidence paths from17/19 reappear in source and unit cases.
Keep17/19 open for now: full state restoration, bounded retry, exact preview and real-backend preservation tests have not passed. Once ported and verified, close as superseded, retaining Git history. No blind merge or CI exclusion.

## Fresh follow-up: PR22 appeared during this review

PR22 feat/interfaces-a1-v21 at9e87107ff0c28f7202b93e8cc766e1132092732d (base057316d/A1 2.1) supersedes the old proposed implementation. Read actual code: email challenge Map removed; emailVerification/resend/result used; shared normalizer, recordUpdateFailure, retry_wait/failed receipts and snapshotHash added. Do not ask Danya to redo these corrected2.1 items.
Independently installed its committed dependencies, built its committed contracts and reran37bot unit tests:37passed/0skipped. These use FakeProduct, NOT PostgreSQL. Then overlaid the current2.2 contracts in isolated checkout: bot/web typechecks FAIL specifically navigation, support({}), expectedDialogueRevision (the old hash/email call errors are resolved).
Remaining source issues: Memo retains editing field/speaker/card/reminder/test answers; support still RU; confirm still fetches newest preview instead of shown hash; same seq-based phase-key caveat. claim/record-failure catches become degraded but keep looping: demonstrate bounded/fatal handling for unknown infrastructure bugs without ack. OPERATION_IN_PROGRESS of the same pending intent must reconcile, not be mistaken for successful completion; evaluate this with real domain error states, not only mock receipt tests.
Follow-up tasks now target PR22, not re-cherry-picking PR19/21. No new PR was merged or closed; full review with actual backend still blocked by PR20 v1.
