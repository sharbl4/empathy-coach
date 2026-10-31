Read AGENTS.md, README.md, hackathon-prompts.md, docs/{product,architecture,api,acceptance}.md and available team-tasks-web-telegram.md.
Anton approved web+Telegram; Telegram-only/apps-web-archive instructions are superseded. Full section7 is current scope.
Danya owns apps/web+apps/bot. Dima owns domain/auth/HTTP. Anton owns contracts/root/dependencies/lock/CI/deploy/model.
Use @between/contracts/product and /http DTOs, not copied BotDomain/client contracts. Bot invokes shared facade; web uses cookie session API, no Supabase/bot/model secrets.
Identity from trusted private sender or verified server cookie only; UserContext issuer and account checked by domain. Preview confirmation precedes every generation. Model text is plain data, no execution.
Persist stable intents/inbox/outbox, handle revisions, partial startup and shutdown. No live error fallback to fixtures; explicit test adapters reject production.
No external issues/team messages without authorization. Preserve uncommitted plans, env, IDE and applied migrations. Report actual checks and remaining live gates.

Current A1 2.2: server env schemas only /runtime; public product/http graph excludes it. Persist navigation/partial answers in domain, email only emailVerification, unknown support region yields no contacts. See contract-v2.2.md and current handoff; do not reuse old signatures silently.
2.2.1 approved: preserve assessment on menu; explicit confirmed discard only. Restore own myRating on reads; run_completed is domain-only successful transaction. Telegram thread edit/reorder keeps stable turn IDs. Read docs/contract-v2.2.1.md and current handoff before integration.
