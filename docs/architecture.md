# Архитектура web + Telegram v2

Решение Антона31.10.2026 заменяет Telegram-only. apps/web рабочий, auth/HTTP — Дима, web+bot — Даня; root/contracts/CI/model/deploy — Антон.

```text
Browser HTTPS → reverse proxy → Fastify /api + web/dist
Telegram private updates → polling ─┐
                                  ├→ один ProductFacade → PostgreSQL
HTTP verified session → UserContext┘                 └→ private network → Windows llama.cpp
```

Один app Node-процесс с HTTP/polling/workers/scheduler; отдельный PG, допустим HTTPS proxy. Нет Supabase/GigaChat/hosted inference. Домен не импортирует transport, factory/import не запускает workers/HTTP. Root scripts/application.mjs явно связывает side-effect-free @between/api.createDomain, @between/api/http.createHttpAdapter, @between/bot.createTelegramTransport.

Identity: Telegram private sender либо opaque server web session; domain-issued UserContext с runtime issuer/account checks. Никакого body ownerId, username/email merge или localStorage authority. Один аккаунт/UUID и одна история в обеих UI. Новые миграции только вперёд, существующие данные не переписываются.

Auth/preview/idempotency/inbox/outbox: [контракт v2](contract-v2.md). До подтверждения полного очищенного snapshot/hash/revision/model/prompt ни одной генерации. Лимит4k включает template/system/input/output/reserve, разные output caps для задач. Model offline не мешает истории/аккаунту/карточкам. Queue bounded, concurrency1, неопределённый run не повторяется автоматически.

Один poller actual botId с DB lease; HTTP не вызывает Telegram handler через fake bearer. Delivery/scheduler opt-in и durable; DST/quiet hours/local dates не зависят от TZ сервера. Сессии/cookies/preview/assessment имеют ownership и атомарные проверки.

Shutdown/partial start: stop accepting, остановить polling/HTTP, abort/drain workers/model requests с лимитом, finally закрыть delivery/scheduler/leases/pool. Health учитывает HTTP/polling/workers/scheduler/DB, не требует доступной модели для чтения истории. Никаких raw URLs/cookies/payload в логах.

QQCloud1CPU/2ГБ требует проверки постоянного процесса/диска/HTTPS; Telegram domain bot этого не доказывает. Начальные caps app640MiB, db512MiB, proxy64MiB оставляют~832MiB ОС, pool target5; не замер. Image собирается на ПК/CI, не VM. PG/model порты не опубликованы, proxy trust exact IP only. Модель слушает private IP, ACL+Windows firewall разрешают только cloud node.

A1 2.2 boundary: @between/contracts/runtime server-only export, browser:null; no public re-export. Dialogue owns transient draft/navigation (idle1h,absolute24h); supportRegion account setting is separate and user-selected, not inferred. Full rules contract-v2.2.md.
