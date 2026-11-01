# Current A1 2.2 / PR21 review snapshot

Contract a71d379b31c65167ef40ece6a384b7ee539bfdeb. Root tests39passed/0skipped; lint success; generated signatures checked. New test cases are schema/serialization/import/lifecycle checks, not DB persistence.
PR21 d97ddf1: independently32bot unit tests pass (FakeProduct), original real production build fails env markers. Controlled runtime-only extraction on its own DTO base makes actual production bundle pass old and strengthened graph/artifact guard, no facade/http stubs. Full2.2 contracts expose bot/web type mismatches and missing API facade/HTTP. Separate negative probe: same update4unknown failures all retryable,0ack,0recordUpdateFailure; this reproduces old unbounded retry.
During review PR22 9e87107 appeared: independently37bot unit tests pass on its committed2.1 (FakeProduct). Verified source corrections for email, shared error/receipt and hashes. Full2.2 overlay still fails bot/web typechecks on navigation/support/assessment. New instructions target22. Actual backend remote remains f9fc301/v1; real HTTP/browser adapter absent.
No PG/Playwright/live Telegram/model tests executed: prerequisites absent, no skipped DB tests credited. SMTP prior separate AUTH+one accepted mail is retained evidence, no additional email or generation performed here. No .env/IDE/teammate work changed; review scratch worktrees under ignored .tools contain no copied .env and no backend stubs.

---
# A1 2.1 review update · 2026-10-31

Contract commit a619dab87c06541256c9155ee6f00cdd021c2f0a; unified current branch feat/web-telegram-integration. Review source: review-pr19-pr20.md; exact contracts: facade-v2.1.md and contract-a1-resolution.md.

Actual new local checks: npm run test:contracts →34passed/0failed/0skipped; includes email/error/preview/auth/27-feature contracts and single-domain shared-entry lifecycle. npm run lint →success. Generated facade --check →success and now mandatory in test:contracts.
Root npm run build still FAILS missing facade/http/bot index. Source-only web release guard FAILS active Supabase import. No DB test or browser/live flow is claimed run by these checks. Participant branches were read, not merged into this checkout.
Read-only current PR19/20 heads match3b7ef64/f9fc301; both old base ed72784, root CI success and integration CI failure. Reviewed actual email/core/privacy/web/session/lifecycle/transport source, not just reports. PR17 not closed because complete preservation of useful preview/example/rating/level paths is not demonstrated.

Local .env presence only (no values printed, file unchanged): DATABASE_URL present; TEST_DATABASE_URL, TELEGRAM_BOT_TOKEN, LOCAL_LLM_BASE_URL/MODEL/API_KEY, SMTP_HOST/FROM, EMAIL_CODE_SECRET, WEB_ORIGIN/WEB_SESSION_SECRET/WEB_LINK_SECRET absent or empty. Presence does not verify DB connectivity. Home GPU, cloud/DNS/private network and SMTP delivery access not supplied for live acceptance. No generation performed.

No external messages/issue or PR updates; no participant code/migration changes; original user worktree files remain outside commits. See final GitHub CI run for the published latest head; do not infer its result from the older snapshot below.

---

## Previous f3ebfc0 verification snapshot
# Integration verification · 2026-10-31

Branch: feat/web-telegram-integration. Base ed72784 preserved; first contract88b83d3, lifecycle3559e0c, corrected approved bot-issued web auth31574f8. Start from latest full branch commit, not the first draft alone.

Actual local checks:
- npm ci --offline --no-audit --no-fund: success,256packages. npm reported deprecated ESLint and esbuild install-script allowlist notices; Vite compilation actually worked afterward.
- npm run test:contracts:27passed,0failed,0skipped. Includes v1 regressions/v2 schema and explicit fake lifecycle adapters; not live domain.
- npm run lint: success.
- PowerShell parser all deploy/model/*.ps1: success. None installed weights, changed firewall or power settings here.
- node scripts/check-compose.mjs: success with synthetic env; schema/ports/caps only.
- Real caddy:2.11.7-alpine caddy adapt with network=none: success. No domain/certificate/load validation.
- npm run build: FAIL explicit missing apps/api/src/domain/facade.ts, apps/api/src/http/index.ts, apps/bot/src/index.ts.
- npm run build:web: TypeScript and Vite compilation passed, release guard correctly FAILS active Supabase import/bundle. Those artifacts must never be deployed.
- npm run e2e: FAIL before browser start: no separate test DB config. With explicit synthetic distinct URLs, server wrapper FAILS missing apps/api/test/browser-adapter.ts. No browser scenario completed; new bot-issued flow was schema-tested, browser rerun still requires B2/C2.
- scripts/test-domain.mjs: FAIL missing new domain/web DB and bot tests. No new PG/auth integration tests ran, no skipped DB tests counted.
- model benchmark without --allow-generation: refuses before network. No generation launched.

Read-only GitHub:
PR18 OPEN at ed7278474e42dbf67624c7e241b9cd16253d8b65: contracts-and-root success, domain-bot-integration failure.
PR19 OPEN feat/telegram-bot at3b7ef64ea6df10fd7ac207f9da8dd2d02966d650, base feat/telegram-integration: root success, integration failure. Uses v1 DomainFacade and autonomous main, requires v2 transport adaptation; not merged.
No team/user messages, PR comments or external issue changes made. Peer contract acceptance unconfirmed.

Live/new architecture N=0. QQCloud process/disk/Docker/DNS/HTTPS, testbot, SMTP delivery, home RTX driver/VRAM/weights/terms/private network, semantic model quality, TTFT/full p50/p95, RAM/load, backup/restore of new schema, reconnect/reboot, shared real account/history and all section7 remain unverified.
Current machine Intel Graphics/~16GB, not target GPU PC; no hardware inference fabricated.
User's hackathon-prompts.md, team-tasks-web-telegram.md, .vscode and real .env preserved outside these commits.
