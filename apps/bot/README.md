# Telegram transport (apps/bot) · contract 2.2.0

Зона Дани (C1). Экспорт `createTelegramTransport: CreateTelegramTransport` из `@between/bot`. Импорт и конструирование ничего не запускают. Процесс, domain, lease, HTTP и heartbeat поднимает `scripts/application.mjs`. DTO берутся только из `@between/contracts/product`; зависимостей, кроме contracts, нет.

## Lifecycle

- `identify()` — только `getMe`, без polling; username обязателен.
- `start(domain, lease)` — отказ, если lease или `domain.shutdownSignal` уже прерваны или transport уже запускался. Регистрирует команды и запускает в фоне polling и outbox-worker под общим сигналом stop | lease | shutdown.
- `finished` резолвится, когда polling закончился: stop, потеря lease, shutdown домена или фатальная ошибка Bot API (401/404/409).
- `stop()` идемпотентен и ждёт завершения обоих циклов. `health().polling` отражает фактический getUpdates.

## Inbox / outbox

- Владелец берётся только из `from` и matching private chat этого getUpdates (`identity.ts`). Inline callback без message, группы, каналы, боты и unsafe integer отвергаются; в домен уходит только `acknowledgeUpdate`.
- `updateCursor` → `resolveUser` → `claimUpdate` (`UpdateReceiptV2`). Статусы `completed` и `failed` приводят только к ack (failed остаётся failed). `retry_wait` ждёт `nextAttemptAt` без обработки, `processing` выполняет сценарий.
- Ошибка, которую сценарий не объяснил пользователю, классифицируется так: временные условия Telegram (`TelegramUnavailable` → `DEPENDENCY_UNAVAILABLE`, 429 → `RATE_LIMITED`), всё остальное — через общий `normalizeDomainError`; неизвестная ошибка → `INTERNAL_ERROR`, без повтора. Затем `recordUpdateFailure`: `retry_wait` — без ack, одно уведомление на первой попытке; `failed` — честное сообщение пользователю и ack. Бюджет из 3 попыток хранится в БД, не в Map. Если сбой не удалось записать, update не подтверждается, а `health().polling=false`.
- Ключи идемпотентности: `intentKey(receipt.intentKey, операция, n)` или id доставки.
- Outbox: `claimDeliveries` (run | reminder) → отправка → `completeDelivery` либо `failDelivery(CHAT_UNAVAILABLE | RATE_LIMITED | DELIVERY_FAILED)`. Повторной генерации нет.

## Сценарии

Почта: состояние читается из `emailVerification(ctx,{})` при старте, рестарте и после ошибок кода; resend использует текущий `challengeId` от домена, адрес повторно не спрашивается. «Код отправлен» показывается только при `state=sent`; cooldown и оставшиеся попытки берутся с сервера. Меню из двух страниц. Режимы understand / say_direct / before_send / thread, каждый шаг — одно короткое сообщение с Назад/Пропустить/Отмена. Своя гипотеза с проверкой цитат или «Не понимаю». Все AI-действия идут одинаково: `createSession` → `createPreview` (маскированная копия от домена) → «Изменить» (`editPreview`, новая revision, старая кнопка устаревает) → «Отправить в модель» (`confirmPreview` по `snapshotHash` → `startRun` с hash из receipt). Повтор неудачного run передаёт `snapshotHash` его preview. `safety:'support'` → текст `support()` без кнопки отправки.

Результаты: основания по категориям, сравнение, evidence с подписью поля; «Как уточнить?» из сохранённого analysis + clarify-run по запросу; тепловая карта 🟢/🟡/🟠 словами с «Почему? / Мягче»; четыре цели. Есть «Полезно/Не полезно», упражнение, роль с тремя уровнями, счётчиком и ранним завершением, примеры, общая история с фильтром сфер и удалением по revision, прогресс и навыки, практика дня, карточки, тест до/после, напоминания (opt-in, время, IANA timezone, тихие часы), «Открыть веб» (одноразовая ссылка без preview с предупреждением), веб-сессии с отзывом, согласие, почта, удаление данных и аккаунта.

## Проверки

`npx tsx --test apps/bot/test/*.test.ts`: mock Telegram (поддельный fetch) и test-only `FakeProduct` по контракту v2. Root `npm test` гоняет их вместе с domain/web DB-тестами Димы. Реальный test bot, БД, SMTP и модель не проверялись.

## Состояние незавершённых шагов

Хранится в домене (`DialogueV2.navigation`, TTL контракта): показанная версия preview и поле правки, говорящий следующей реплики ветки, начатая карточка, частичные ответы теста (submit с `expectedDialogueRevision`), редактируемое поле напоминаний, поле региона помощи. В памяти процесса — только вид истории (после рестарта с первой страницы, решение Антона) и защитная revision правки сохранённой ситуации: если она потеряна, правка отклоняется, а не угадывается.

Confirm и правка preview работают только с показанной версией: если её изменили (например, на сайте), бот показывает новую версию, старая кнопка ничего не подтверждает. «Отправить» есть только при `budget.fit==='fits'`.

Регион помощи — явный выбор пользователя (`supportRegion`/`updateSupportRegion`), `support({})` без подстановки страны; без региона — общий текст без номеров.

Если домен не может записать исход update (`claimUpdate`/`recordUpdateFailure`/ack) `MAX_UNRECORDED` раз подряд, poller останавливается с `PollerStalled` (без ack), `finished` резолвится, root останавливает процесс. `OPERATION_IN_PROGRESS` того же намерения уходит в `retry_wait`, а не считается успехом. Ключи идемпотентности: `intentKey(receipt.intentKey, операция, порядковый номер этой операции)` — не зависят от других вызовов в обработке.
