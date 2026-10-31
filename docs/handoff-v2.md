# Единый старт: web + Telegram · A1 2.1.0

**Контракт: a619dab87c06541256c9155ee6f00cdd021c2f0a.** Общая ветка: feat/web-telegram-integration. Брать актуальный HEAD этой ветки целиком после git fetch origin; старые31574f8/f3ebfc0 — история, не последняя версия A1.
Версия npm workspace @between/contracts остаётся0.1.0; PRODUCT_CONTRACT_VERSION=2.1.0 — версия внутренних границ, не пакет из registry.

Сверка31.10.2026: PR20 f9fc3019276e081937bd3add82ade62801235717 и PR19 3b7ef64ea6df10fd7ac207f9da8dd2d02966d650 оба DRAFT/OPEN на старой базе ed72784/feat/telegram-integration. Оба всё ещё используют /domain1.0.0; фактический CI: root зелёный, integration красный. [Review с конкретными местами](review-pr19-pr20.md). Не сливать до переноса и нового review. Принятие нового контракта участниками не подтверждено; сообщений/комментариев/issues не отправлено.

Читать вместе: [нормативное устранение пробелов](contract-a1-resolution.md), [точные сгенерированные сигнатуры и все27 функций](facade-v2.1.md), [семантика v2](contract-v2.md). В случае старых сигнатур31574f8 приоритет у product.ts/http.ts и A1 resolution.

## Диме: B1/B2/B3 — точное задание

Без перезаписи чужих веток/force-push:
git fetch origin
git switch -c feat/api-a1-v21 origin/feat/web-telegram-integration
git cherry-pick f9fc3019276e081937bd3add82ade62801235717
При конфликте metadata сохранить root Fastify/static dependencies, /http export и build configuration; добавить полезный typecheck tests из своего PR. Не брать весь старый package.json/tsconfig поверх нового. Исходные ветка/PR20 остаются сохранены. Следующий PR направить в feat/web-telegram-integration; старый #20 не считать автоматически интегрированным.

1. apps/api/src/index.ts экспортирует createDomain:CreateProductDomain, фасада — ProductFacade из /product, без локальных DTO. Все read методы теперь принимают input object (например account(ctx,{}), session(ctx,{id})); write — input+UUID key; null responses соответствуют Zod, не undefined.
2. Убрать старт из фабрики: constructor открывает ресурсы/валидирует, acquirePollerLease(botId) отдельно, start отдельно и идемпотентно. Root создаёт ОДИН домен; не требовать DomainOptions.botId в ProductOptions. Очередь/maintenance/reminder scheduler запускаются один раз в start, closes освобождают даже частичный старт. Сохранить max pool5 и execution permit до фактического завершения модели.
3. emailVerification(ctx,{}) читает актуальное состояние из DB; requestEmailCode(ctx,{email},key), resendEmailCode(ctx,{challengeId},key) возвращают EmailVerificationStatus; verifyEmailCode(ctx,{challengeId,code},key) — EmailVerificationResult {account,verification:{state:'verified'}}. Успех не может возвращать неподтверждённый account. Статус только maskedEmail, expiry/cooldown/attempts; ID не зависит от FSM/Map. Concurrent verify/resend, expiry, wrong-code intent replay, SMTP failure/crash/restart — реальные PG tests.
4. Использовать общий DomainError, unknown→INTERNAL_ERROR без raw details и auto retry. UpdateReceiptV2/recordUpdateFailure сохраняют общий budget3/terminal state; acknowledge не превращает failed в completed. Не маскировать неизвестные ошибки как временную DEPENDENCY_UNAVAILABLE.
5. Реальный createPreview/read/edit/confirm: полный очищенный outgoing snapshot всех полей; dependencies+templateHash+model/prompt/revision; startRun/retry принимают snapshotHash и используют только подтверждённую запись. Не создавать production SQL confirmation за пользователя. Idempotency HMAC оригинального валидированного намерения до lossy masking; не хранить его raw копию.
6. WebSessions поднять в ProductLifecycle: openBrowser/authorizeWebMutation/resolveWebSession, issueWebLink/redeemWebLink, list/logout/revoke-one/revoke-all. Bot→/auth/connect#token→явный POST. Cookie/TTL/idle/CSRF/Origin/ACCOUNT_CONFLICT — строго A1 resolution; raw cookie только private adapter return/Set-Cookie.
7. apps/api/src/http/index.ts экспортирует CreateHttpAdapter. Fastify static webRoot + shared webApi/authApi/authBindings. GET health/live и ready безопасны, trustProxy только точные IP, no broad CORS/no sensitive request logs; public response validation обязательно.
8. Применённые001–006 НЕ менять: дальнейшие migrations007+; сохранить старую историю, FK, checksums, HMAC и owner-scoped queries. Дополнительные env имена не вводить молча: queue canonical AI_MAX_QUEUE_LENGTH/options.maxQueueLength, не старый AI_QUEUE_LIMIT. Root секреты только env/hosting.
9. B3 реализует ВСЕ строки facade-v2.1.md: learning outputs/contexts/draft-only/thread/role levels/daily/reminders/skills/cards/до-после/rating/internal analytics/support. Порядок можно разбить; отсутствие функции честно блокирует полную приёмку, не удалять контракт/job и не добавлять fake green stub.

Проверки: API build + API/test typecheck; новые domain*.test.ts и web*.test.ts на отдельной реальной DB, zero skips; negative ownership/revision/preview/CSRF and concurrent exchange tests; библиотечный import без workers/HTTP/polling.
Browser gate: apps/api/test/browser-adapter.ts экспортирует startBrowserTestServer({origin,port,webRoot,databaseUrl}):Promise<{close():Promise<void>}>. Только NODE_ENV=test, loopback3011, отдельная DB. Test Telegram adapter вызывает issueWebLink для синтетических A/B, POST /__test/issue-web-link {account:'A'|'B'} возвращает private IssuedWebLink; обычный HTTP redeem не подменяется. Seed A: «Тестовая история участника A», B её не видит. SMTP/model/clock adapters явные, helper не импортируется production.

## Дане: C1/C2/C3 — точное задание

git fetch origin
git switch -c feat/interfaces-a1-v21 origin/feat/web-telegram-integration
git cherry-pick 3b7ef64ea6df10fd7ac207f9da8dd2d02966d650
Сохранить root bot export dist/index.js, contracts-only dependency и entrypoint src/index.ts. Не восстанавливать старый root start/main и не копировать старый manifest поверх новых exports. Исходный #19 сохранить; следующий PR направить в feat/web-telegram-integration.

1. apps/bot/src/index.ts экспортирует createTelegramTransport({token}):TelegramTransport. identify только getMe; start(domain,lease) запускает один poller+delivery loop; finished/health/stop по контракту. Из import graph убрать createDomain, собственные signals/process lifecycle/heartbeat; общий root управляет процессом.
2. flows/render/test FakeDomain перевести на /product, HTTP client на /http. Никаких BotDomain/local DTO, fake bearer token или owner из callback. Сохранить trusted private identity/inline rejection/plain text/chunking и negative tests.
3. Удалить challenges Map. На resume/restart читать emailVerification(ctx,{}); verify использует восстановленный challengeId+код, resend — текущий challengeId без повторного пользовательского email. После ошибки/refetch отображать server cooldown/remaining attempts, не утверждать «код отправлен» для sending/failed/unknown.
4. Unknown error не transient: общий normalizer/policy, durable recordUpdateFailure, максимум3 попытки через DB, не Map с обнулением после рестарта. Ack лишь определённый outcome, не в finally; failed receipt не становится completed.
5. Каждый AI action проходит createPreview→отображение ВСЕХ полей→edit/re-mask→confirmPreview→startRun с hash/revision. Не вызывать v1 analyze/sayDirect напрямую, не пересобирать скрытое содержание после confirm. Выдача сохранённого run и delivery run|reminder не запускают генерацию заново.
6. apps/web уже в workspaces/build/CI. Активный src/lib/auth/supabase.ts ещё блокирует release: заменить его cookie-session client и удалить active SDK/fixture imports; архив сохранить вне active src. Same-origin /api, credentials cookie, shared types; VITE_PUBLIC_* только несекретные, никаких localStorage переписок/auth/owner.
7. В боте «Открыть веб» — issueWebLink, не самосборка URL; disable preview+не пересылать. /auth/connect очищает fragment немедленно и показывает «Подтвердить вход»; только POST redeem. /auth/login без сессии даёт путь в своего бота. Cookie авторизация → та же «История», refresh, «Выйти», отзыв session фактический. Не объединять аккаунты по email.
8. C3 весь раздел7, включая подсветку evidence с keyboard/mobile и Telegram эквивалент, practice/reminders/settings/skills/cards/assessment. Перенести полезные examples/privacy/rating/levels/evidence renderer из #17 на общие DTO. #17 пока не закрыт, так как сохранность этих сценариев в #19 не доказана.

Проверки: bot unit/integration с явным FakeDomain на /product; transport import/start/partial shutdown/no duplicate worker; отдельный frontend typecheck/build; Playwright common history/login/refresh/logout/two-user isolation с B2 test adapter. Стабильные accessible labels перечислены в e2e/shared-account.spec.ts. Нельзя проверять только fixture UI и назвать путь live.

## Единый checkpoint и доступы

Первый путь: private Telegram → реальная домашняя модель через QQCloud → сохранённый валидированный run → одноразовая ссылка из того же бота → явный веб exchange → та же история. Затем restart, two-user isolation, правки/progress в обеих UI, offline-model read path; затем весь раздел7.
Необходимы: отдельный test bot/token и второй тестовый Telegram пользователь/чужой телефон; отдельная runtime DB и TEST_DATABASE_URL; настоящий SMTP+sender+доставка почты; три server secrets; доступ к реальному GPU-ПК/принятие Gemma terms/weights/private endpoint key; QQCloud permanent process/disk/Docker/SSH/DC; закрытая сеть двух узлов/ACL/firewall; реальный домен/DNS/HTTPS/WEB_ORIGIN. Секреты только env/hosting, не чат/Git. Legal web-telegram-2 ещё требует утверждения до публичного сбора.
Ни root tests, ни авторские mocks/SQL confirmations не доказывают live. Модель N=0 в интеграционной проверке, метрики ещё неизвестны. Прежняя оценка остаётся предварительной: checkpoint3–5 рабочих дней после доступов и синхронизации B1/B2/C1; все27 функций25–40 человеко-дней. Уточнить после первого перенесённого PR.
