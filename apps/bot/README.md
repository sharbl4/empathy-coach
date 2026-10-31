# Telegram transport (apps/bot)

Зона Дани, issue #16. Единственный poller, только private chats, прямые вызовы `@between/api.createDomain`. DTO и сигнатуры — только `@between/contracts/domain` (TELEGRAM_CONTRACT_VERSION 1.0.0). Без HTTP, bearer, Mini App и зависимостей кроме workspace-пакетов.

## Запуск

Через root: `npm run build`, `npm start` (scripts/launch-bot.mjs). Env — `RuntimeEnvironment` из contracts; при ошибке печатаются только имена полей. Порядок старта: `getMe` → `createDomain({botId: String(me.id), …})` → проверка `health().pollerLease` → setMyCommands → delivery worker + heartbeat → `getUpdates`. Остановка по SIGINT/SIGTERM или `domain.shutdownSignal`; в `finally` закрываются heartbeat, worker и домен, в том числе после частичного старта.

## Устройство

- `telegram.ts` — минимальный клиент Bot API на `fetch`. URL содержит токен, поэтому ошибки (`TelegramError`, `TelegramUnavailable`) не несут URL, cause и сырого текста. На 429 — не больше двух повторов, ожидание до 30 с.
- `identity.ts` — владелец только из `message.from` или `callback_query.from` при `chat.type=private`, `chat.id === from.id` и safe integer. Inline callback без `message`, группы, каналы и боты отвергаются до любого доменного вызова (кроме `acknowledgeUpdate`).
- `runtime.ts`:
  - `Poller`: offset из `updateCursor()`, `resolveUser` → `claimUpdate` (completed → только ack). Ack только после определённого исхода. Временный сбой оставляет update неподтверждённым, повтор идёт с тем же `intentKey`. Больше 3 попыток за процесс — сообщение пользователю и ack.
  - `DeliveryWorker`: `claimDeliveries` → отправка → `completeDelivery` или `failDelivery(CHAT_UNAVAILABLE | RATE_LIMITED | DELIVERY_FAILED)`; попытки ведёт домен.
  - `Heartbeat`: атомарная запись `BOT_HEALTH_FILE` раз в 15 с.
- `flows.ts` — сценарии на стадиях `Dialogue`. Ключи идемпотентности выводятся из `intentKey` receipt или id доставки. Версия кнопки = `dialogue.revision`, поэтому после изменения шага кнопка устаревает. Генерация запускается только после «Отправить в модель» на экране с точной копией всех полей.
- `text.ts`, `ui.ts` — plain text без parse_mode, нарезка < 3500 символов, callback_data ≤ 64 байт без пользовательского текста.

## Проверки

`npx tsx --test apps/bot/test/*.test.ts` — mock Telegram (поддельный `fetch`) и test-only `FakeDomain` по контракту (WeakSet-issuer, receipts, outbox). Root `npm test` запускает эти тесты вместе с domain DB-тестами Димы на отдельной PostgreSQL. Реальный test bot не проверялся.

## Пробелы контракта (нужно решение Антона/Димы)

- `EmailVerification.challengeId` не хранится в `DialogueDraft`: id держится в памяти процесса, после рестарта код нужно запросить заново. Метода resend нет — повтор идёт через новый `requestEmailCode`, для этого бот просит адрес ещё раз.
- В `DialogueStage`/`DialogueDraft` нет стадий для предпросмотра со скрытием данных, контекстов, уровней роли, каталога примеров, оценок полезности, практики дня, навыков, карточек, теста до/после, ветки переписки, «До отправки», веб-входа. Это всё раздел 7 плана v4, в боте не реализовано и ждёт A1/B3.
- Курсоры истории хранятся в памяти процесса (это только навигация); после рестарта «Дальше» начинает с первой страницы.
- Форма ошибок фасады: бот читает `error.code` из `DomainErrorCode`; всё остальное считает временным сбоем.
