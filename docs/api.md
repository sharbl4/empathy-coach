# In-process API · Telegram domain 1.0.0

Источник [точных сигнатур/DTO](../packages/contracts/src/domain.ts): @between/contracts/domain. [Семантика фасады](domain-contract.md). @between/api.createDomain импортируется без Fastify, bot вызывает методы напрямую. Старый bearer/HTTP не используется.

Группы: account/consent/email; dialogue; create/read/update/list/delete sessions; analyze/read/retry runs; reply feedback/examples; exercise/feedback; roleplay start/turn/finish; sayDirect; progress; delete data/account; health/close. DTO strict Zod, Telegram BIGINT передаётся строкой, внутренние IDs UUID.

DomainFailure содержит code/requestId, включая EMAIL_NOT_VERIFIED, CONSENT_REQUIRED, CODE_INVALID/CODE_EXPIRED, NOT_FOUND, REVISION_CONFLICT, IDEMPOTENCY_CONFLICT, RATE_LIMITED, DEPENDENCY_UNAVAILABLE. Transport отображает безопасные локальные сообщения, не сырой Error.

Все записи требуют UUID key; ссылки — ownership/revision. SessionQuery: limit1..50, opaque cursor, поиск title, updatedAt DESC,id DESC. Чужие IDs → NOT_FOUND.

[Старые HTTP JSON-примеры](archive/http-api-v0.1.md) сохранены и валидируются как регрессия форматов, а не публичный API. Новые схемы проверяются domain.test.ts; схемы не доказывают реализацию фасады.
