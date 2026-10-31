# Общий контракт web + Telegram v2 · A1

Новая явная версия решения Антона от31.10.2026 заменяет Telegram-only. Источник: packages/contracts/src/{product,http}.ts, exports @between/contracts/product и /http. Старые DTO/v1 сохранены для миграции/архивных регрессий, не новая публичная схема. Все27 функций раздела7 входят в текущий объём, а не roadmap. Фасада названа ProductFacade/CreateProductDomain. Первый сквозной путь реализуется раньше остальных функций, но отсутствие остальных блокирует полную приёмку.

## Identity и lifecycle

UserContext непрозрачен, с account UUID, Telegram BIGINT/string и transport. Его выдаёт домен после проверки issuer/аккаунта/состояния: Telegram sender только из доверенного private update; web только по действительной серверной сессии. Username/email никогда не связывают произвольные аккаунты. Callback/body/URL могут указывать только ресурс, не владельца. Каждый вложенный ID/revision проверяется заново. Test-only adapters отказываются в production.

createDomain(options) импортируется и конструируется без запуска HTTP/polling/workers. start() запускает только доменные workers/scheduler явно; createTelegramTransport импортируется без polling, identify() получает реальный botId, acquirePollerLease(botId) удерживает один poller, start(lease) запускает его. HTTP, polling и workers — один процесс. При ошибке частичного старта/сигнале: остановить приём HTTP/updates, abort/drain задач с лимитом, прекратить scheduler/delivery, закрыть transport/HTTP/domain/pool в finally, не бросать живой lease при exitCode1. Offline LLM не выключает чтение истории/аккаунта/карточек.

## Веб-вход в тот же аккаунт

GET /api/auth/session создаёт/проверяет opaque browser binding и возвращает только PublicWebSession + CSRF token. Cookie — HttpOnly, host-only, path=/, Secure в production, SameSite=Lax; имена __Host-between-session и __Host-between-link. В HTTP-local dev/test — отдельные имена, не понижение production. Сессионный256bit token хранится на сервере только в HMAC/hash; абсолютный TTL24ч, idle2ч. SessionSecret и LinkSecret независимы от EMAIL_CODE_SECRET/model/bot secrets.

POST web-links (точный Origin и CSRF) создаёт5-минутный challenge, привязанный к secret binding cookie данного браузера. Возвращается deep-link в фактический bot username и8-значный код для сравнения. /start web_<claimCode> только в private: inspectWebLink привязывает к подтверждённому domain account; бот показывает код/время/предупреждение и требует отдельного approve/deny. Не подтверждать чужие ссылки. Нажатие /start не является согласием на вход или обработку данных.

Статус/consume доступны только исходному browser binding, знания UUID недостаточно. Одноразовый consume транзакционно создаёт web session того же аккаунта; raw token HTTP-адаптер кладёт только в Set-Cookie, не JSON/URL/localStorage. Private BrowserAccess/ConsumedWebLink никогда не сериализуются; HTTP response валидируется строгой public schema. Если браузер уже авторизован другим аккаунтом — ACCOUNT_CONFLICT, сначала явный logout; автоматического merge/перепривязки нет. Logout/revoke all/delete account/истечение немедленно лишают доступа. Код и auth URL/cookies/CSRF не логируются. Конкурентный consume и повтор callback тестируются.

Любое web mutation требует точного WEB_ORIGIN, X-CSRF-Token, актуальной cookie/session и UUID Idempotency-Key; missing/null Origin отвергается. CORS wildcard отсутствует. Reverse-proxy trust — только конкретный проверенный IP, не true/CIDR/X-Forwarded-For от произвольного клиента. IP/UA не заменяют аккаунт. XSS: модельный текст plain text/React escaping, не HTML.

## Privacy preview и генерация

SessionInputV2 различает understand/say_direct/before_send/thread. «До отправки» и «Сказать прямо» не требуют выдуманного сообщения собеседника. Thread — ordered self/other, не system/tool/assistant роли модели. Собственная гипотеза до анализа: точные цитаты либо unsure. Редактирование меняет revision и инвалидирует старые подтверждения.

createPreview получает только клиентский ввод/ссылки. Сервер строит полный модельный snapshot со всеми контекстами, цитатами, историей роли/ветки, автоочищает email/телефоны и выдаёт текстовые slots с opaque fieldId, порядком и ролями. Клиент редактирует только разрешённые поля, не history/analysis/owner. Все изменения заново очищаются, получают revision/hash. confirmPreview подтверждает именно весь snapshot/hash; нет генерации до действующего confirmed preview и token budget fit. Model/prompt/template или данные изменились → PREVIEW_STALE. Нельзя молча обрезать input/output. Полный бюджет: шаблон+system+input+output+reserve ≤ context. Неизвестный budget не выдавать за fits.

startRun/retry принимают только подтверждённый owned previewId/revision и expected session revision. Модель получает этот snapshot, а не повторно собранный/неподтверждённый input. Строгая output schema, exact evidence по fieldId/quote; turn3 роли только итог, ранний finish после turn1. Reasoning/refusal/partial output не становятся успешным run. Очередь ограниченная, GPU concurrency1, неопределённый исход не перезапускает генерацию. Удаление/отзыв/изменение блокируют поздний output/delivery.

## Общие данные и полный объём

Все операции в operations типизированы один раз; webApi связывает HTTP с ними, bot вызывает методы фасады напрямую. Path/query/body собираются сервером с запретом коллизий, strict schema не принимает ownerId. У всех mutable методов UUID intent key с namespace account+operation+resource, canonical validated payload и SQL unique/transaction; другой payload того же ключа —409. Обновления из двух интерфейсов видны по одной DB/revision, конфликт не затирает данные. Пагинация opaque cursor updatedAt DESC,id DESC, limit1..50.

Сохранены durable inbox/offset/intent, outbox attempts/lease, shutdownSignal. Ack не выполняется в finally до определённого исхода; delivery failure не вызывает новую генерацию. Сессии удаляются отдельно от учебных данных и аккаунта; аккаунт удаляет web sessions, задания/notifications/привязки. Старые миграции и данные не переписывать; существующие UUID нельзя приписать Telegram по email.

Напоминания только opt-in, timezone выбрана пользователем (IANA), quiet hours/отписка доступны в обоих интерфейсах; delivery только Telegram. DST gap — следующий допустимый момент, overlap — один раз на localDate. Daily completion уникально account+content version+localDate, при повторах не растут стрики. Старые localDate не пересчитываются задним числом при смене timezone. Автозадания — редакционные, не скрытые генерации модели без preview.

Карточки/примеры имеют contentVersion;5–10 синтетических примеров запускают настоящий анализ, готовый ответ не подставляется. Оценки попыток0–2 отделены от счётчиков. До/после —3–5 сопоставимых заданий с рубрикой0–2, server-owned ключами; followup не раньше7 календарных дней в сохранённой baseline timezone. Endpoint отвергает score/eligibleAt из клиента. Это учебный результат, не доказательство психологического эффекта.

Полезность — own run upsert, изменение оценки не дубль. Аналитика — allowlisted events/context/usefulness без текста/внешних trackers; aggregate report внутренний, не публичный доступ к данным других пользователей. Support contacts только проверенные источники/дата/выбранный пользователем регион, без обещания распознать опасность и без выдуманных телефонов.

## Передача без внешних сообщений

Согласование минимального checkpoint: Дима реализует Account/Browser binding/session/preview/run/history и корректный lifecycle; Даня импортирует /product и /http, строит web+bot на этих DTO. Дополнительные DTO раздела7 фиксируются сейчас; реализация всех функций обязательна до полной приёмки. Этот файл — локальный материал для сверки, не свидетельство, что Дима/Даня уже подтвердили контракт. По текущему указанию Антона внешние issues/комментарии/сообщения не отправляются.
