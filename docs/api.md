> Current A1 protocol2.1.0: [exact signatures/endpoints](facade-v2.1.md), [email recovery/error/HTTP rules](contract-a1-resolution.md).

# API v2: shared facade + session HTTP

Источники: [product.ts](../packages/contracts/src/product.ts), [http.ts](../packages/contracts/src/http.ts), [семантика](contract-v2.md). imports @between/contracts/product, /http, /product-fixtures (последний только test).
Все27 функций раздела7 имеют common DTO/operations; webApi связывает каждую user operation с endpoint, bot вызывает typed UserMethods напрямую.

Auth: GET /api/auth/session, GET /api/auth/entry, POST /api/auth/web-links/redeem, POST logout, GET/DELETE sessions. Только POST redeem body содержит краткоживущий link token; public response JSON никогда не содержит session token или private CookieMaterial; HTTP adapter только Set-Cookie. Origin+CSRF и stable UUID для mutation, серверная session проверяется до domain-issued context.

Product paths: account/consent/email/dialogue/sessions/previews/runs/roleplays/examples/progress/practice/cards/reminders/assessments/events/support. Конкретные method/path/input/response закреплены webApi/authApi, не копировать DTO вручную.
Path/query/body собираются без коллизий, строго валидируются; id ресурса не owner. Ответ перед send проверяется public response schema.

ProductError code/requestId и HttpErrorStatus включают401,403(CSRF/Origin/consent),409(revision/preview/idempotency/link/assessment due),410 expired,422 token/input budget,429,503. Сырые Error/SQL/SMTP/модельный output не отправлять.
Pagination limit1..50/opaque cursor, same account/revision в двух интерфейсах. Unknown fields/role history/score/owner injection отвергаются.
Старые HTTP examples в archive проверяются отдельно, не current API.
