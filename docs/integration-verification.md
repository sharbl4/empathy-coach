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
