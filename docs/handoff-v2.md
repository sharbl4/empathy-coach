# Передача web + Telegram v2 · 31.10.2026

Текущий контракт: **31574f8f92a6f480997d6aad9af72626594cb278** (согласованный bot-issued link, заменяет обратный flow из первого черновика).
Первый интеграционный контракт: **88b83d3aaefc45765188f5f07922274050607996**. Последующие уточнения pagination/lifecycle находятся в текущей ветке feat/web-telegram-integration; брать её последний интеграционный commit целиком, не cherry-pick только первого контракта.
Исходная ветка PR #18 feat/telegram-integration: ed7278474e42dbf67624c7e241b9cd16253d8b65. При чтении PR он открыт; более свежих реализаций отсутствующих модулей в checkout нет. PR #17 — предыдущий bot prototype. Новый PR #19 feat/telegram-bot (3b7ef64ea6df10fd7ac207f9da8dd2d02966d650, base feat/telegram-integration) использует contracts/domain1.0.0: доверенный private identity и cleanup улучшены, но нет src/index.ts/CreateTelegramTransport, он импортирует старый DomainFacade и запускает собственный main/heartbeat. Нужен адаптационный commit к product v2 и общему lifecycle; не сливать как уже совместимый. Его фактический CI: root success, integration failure. При bounded polling retries не ack неопределённое доменное намерение без durable outcome; user content/error logs не добавлять. Никаких внешних сообщений/issue updates не отправлено. Согласование с Димой/Даней ещё не подтверждено: Антон передаёт этот файл и собирает ответы.

## Порядок и зоны

1. Антон: /product и /http — единственный source of truth; v1 остаётся архивным. Новый lifecycle stopAccepting/health, roleplay/runs/web-session pagination, deleteSession expectedRevision — часть v2.
2. Дима B1: apps/api/src/domain/facade.ts и экспорт createDomain из @between/api строго CreateProductDomain. Никаких auto-start/import side effects. Safe runtime-issued UserContext, account+email+consent, stable intents/inbox/outbox, shared sessions/history/preview/run. Затем все операции раздела7. Новые SQL migrations, pool первоначально max5, обязательные domain*.test.ts с отдельной DB, concurrency/ownership/revision/confirmation tests.
3. Дима B2: apps/api/src/http/index.ts экспортирует CreateHttpAdapter. Fastify static webRoot + /api, exact WEB_ORIGIN, CSRF, cookies HttpOnly/Secure(prod)/SameSite=Lax/Path=/, __Host- prefix без Domain, auth URL/cookies/body logs disabled, exact trustedProxyIPs. Session/link DB hashes, bot-issued link, одноразовый POST redeem/browser binding, active revocation. Все HTTP handlers из webApi/authApi; private cookie result никогда не JSON. GET /api/health/live и /ready без payload/secret. web*.test.ts реально проверяют PG/session/csrf/origin/link races; import не слушает порт.
4. Даня C1: apps/bot/src/index.ts экспортирует CreateTelegramTransport (identify без polling; start принимает domain/lease; finished завершается при fatal; stop идемпотентен; health). Только trusted private update, shared DTO, никаких bearer/local BotDomain/ownerId. Inbox ack только после определённого исхода; outbox delivery failure без повторной генерации.
5. Даня C2: apps/web/src заново подключает cookie-session HTTP через shared contracts, удаляет активный Supabase импорт/fixture fallback (старые исходники можно перенести в archive вне src). В боте «Открыть веб» вызывает issueWebLink; сайт /auth/connect забирает fragment token, немедленно очищает URL и ждёт кнопку «Подтвердить вход» (POST redeem). На обычном /auth/login — ссылка «Открыть Telegram». После входа ссылка «История», кнопка «Выйти». Синхронные изменения revision из обеих UI; все27 функций по назначению.

## Browser gate для B2/C2

Корневой scripts/browser-test-server.mjs требует **apps/api/test/browser-adapter.ts** (ещё отсутствует):
export async function startBrowserTestServer({origin,port,webRoot,databaseUrl}): Promise<{close():Promise<void>}>.
Только NODE_ENV=test, loopback3011, отдельная DB с test в имени. Создаёт реальные DB/domain/HTTP, синтетический trusted Telegram адаптер, локальные SMTP/model adapters; никаких реальных сетевых секретов и inference.
Test-only POST /__test/issue-web-link {account:'A'|'B'} вызывает issueWebLink через trusted Telegram test adapter и возвращает IssuedWebLink. Вход погашает только обычный HTTP POST redeem после явной кнопки; GET/HEAD не расходует token. Две синтетические записи с verified email/consent и история «Тестовая история участника A» для A; B её не видит. Этот helper отсутствует в production dependency graph/exports. Он не включается env-флагом внутри боевого HTTP.
Playwright проверяет linked login, same DB history, refresh, cookie logout, two-user isolation. Старые e2e сохранены e2e/archive: Supabase/password/UI foundation заменены новой auth-механикой. Реальные HTTP/DB тесты обязательны отдельно; browser adapters не считаются live.

## Проверки и сроки

npm run build/typecheck явно блокируются отсутствующими facade/http/bot index, build:web выявляет активный Supabase. Не убирать эти gates. Root boundaries tsc проверяет точные сигнатуры трёх factories.
Доступы: отдельные test bot/DB/SMTP; домашний GPU с принятыми владельцем Gemma terms; QQCloud постоянная VM/диск/Docker/сеть/домен ещё не подтверждены.
Оценка после доступа: первый checkpoint 3–5 рабочих дней при параллельной работе; полный раздел7 25–40 человеко-дней (~2–3 рабочих недели втроём). Уточнить после B1/B2/C1 и модельных замеров; это оценка, не обещание старого срока.

Политики docs/legal пока draft telegram-1 с явным предупреждением. Версия web-telegram-2 в схеме — идентификатор согласования, не доказательство утверждённого текста. До реального consent/public collection Антон обновляет/утверждает текст и data-flow условия.
