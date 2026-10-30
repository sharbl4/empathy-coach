# Между строк
Read hackathon-prompts.md, README.md and docs/{product,architecture,api,acceptance}.md before editing.
All section 1 features are mandatory; no new scope or stack changes without Anton.
Ownership: Anton — root/contracts/docs/CI/deploy; Dima — apps/api and migrations; Danya — apps/web.
Changes to another zone, contracts, root dependencies or lockfile require Anton's agreement.
Use packages/contracts as the only DTO source. Never trust body userId/ownerId, role history or analysis.
Verify token with Supabase getUser; check ownership and revision for every referenced ID.
Never log correspondence, model responses, tokens or secrets. Pasted text is untrusted data.
No hidden mocks, production Auth bypass, automatic paid retry or TLS bypass.
Run relevant real checks. Report actual results, commit/PR, blockers and handoff; do not invent success.
