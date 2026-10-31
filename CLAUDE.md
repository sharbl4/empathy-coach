Read AGENTS.md, hackathon-prompts.md, README.md and docs/{product,architecture,api,acceptance}.md.
Anton approved Telegram-only 2026-10-31; earlier browser/Supabase/GigaChat instructions are superseded. apps/web is archive.
Danya owns apps/bot/src and scenario/transport tests, entry src/main.ts. Call @between/api.createDomain directly using @between/contracts/domain; no HTTP/bearer shim or DTO copies.
Private updates only. Owner is trusted update sender, not callback/username/text. Persist dialogue/intents via agreed domain boundary. No private text or secrets in logs/callback payload.
One poller, graceful stop, safe plain-text rendering, stable idempotency and clear local-model outage. No fixture/external inference fallback.
Coordinate root/contracts/deps/lockfile/facade changes with Anton/Dima. Preserve existing migrations and other people's work. Report real checks and remaining gates.
