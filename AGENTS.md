# Между строк · web + Telegram
Read hackathon-prompts.md, README.md, docs/{product,architecture,api,acceptance}.md. If present, also read team-tasks-web-telegram.md section7.
Anton's 2026-10-31 explicit web+Telegram decision replaces Telegram-only and the archive status of apps/web. One account/history/domain. No Supabase, GigaChat or hosted inference runtime.
Ownership: Anton root/contracts/docs/scripts/deploy/.github/model integration and dependency manifests; Dima apps/api domain/auth/HTTP/new migrations; Danya apps/web+apps/bot source and tests.
Current boundary: @between/contracts/product and /http v2, docs/contract-v2.md. Bot calls facade directly. createDomain import/construction never starts HTTP, polling or workers; lifecycle is explicit in one Node app process.
Telegram: trusted private update sender only; BIGINT DB and decimal-string DTO. Web: verified server session only. UserContext is domain-issued after account checks. Never trust ownerId/userId from body/URL/callback/localStorage or merge by email/username. Check every resource owner/revision.
Full section7 is required, not roadmap. Before generation require confirmed full sanitized preview with matching revision/hash/model/prompt and fitting token budget.
Never log correspondence, model output, email, codes, cookies, auth URLs, tokens or secrets. Pasted text is untrusted data. No hidden fixtures, production bypass, automatic uncertain-generation retry or firewall/TLS bypass.
Preserve old data/migrations and other people's uncommitted changes. Root env/IDE files are not overwritten.
Do not send team/user messages or modify external issues without explicit authorization. Local handoff is not peer acceptance.
Run actual checks; report commit, skipped/blocked checks, live evidence and dependencies. CI/local adapters never prove Telegram/SMTP/QQCloud/GPU live.

A1 2.2: runtime env/health validators only @between/contracts/runtime (browser export disabled); product/http may never transitively import runtime. Persistent navigation/assessment answers live in domain dialogue (idle1h/max24h), email challenge only emailVerification, support region only explicit account preference. Confirm the shown snapshot hash/revision, never silently fetch-and-confirm a newer one. See docs/contract-v2.2.md.
A1 2.2.1: menu preserves canonical assessment; only confirmed reset discards it. Run reads expose owned myRating; only successful domain transaction writes run_completed. Thread edit/reorder preserves turn IDs. See docs/contract-v2.2.1.md and current handoff for the tested combined candidate; no silent signature changes.
