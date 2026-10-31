# Telegram transport (apps/bot) · contract v2

Зона Дани (C1). Экспорт `createTelegramTransport: CreateTelegramTransport` из `@between/bot`. Импорт и конструирование ничего не запускают. Процесс, domain, lease, HTTP и heartbeat поднимает `scripts/application.mjs`. DTO берутся только из `@between/contracts/product`; зависимостей, кроме contracts, нет.

## Lifecycle

- `identify()` — только `getMe`, без polling; username обязателен.
- `start(domain, lease)` — отказ, если lease или `domain.shutdownSignal` уже прерваны или transport уже запускался. Регистрирует команды и запускает в фоне polling и outbox-worker под общим сигналом stop | lease | shutdown.
- `finished` резолвится, когда polling закончился: stop, потеря lease, shutdown домена или фатальная ошибка Bot API (401/404/409).
- `stop()` идемпотентен и ждёт завершения обоих циклов. `health().polling` отражает фактический getUpdates.

## Inbox / outbox

- Владелец берётся только из `from` и matching private chat этого getUpdates (`identity.ts`). Inline callback без message, группы, каналы, боты и unsafe integer отвергаются; в домен уходит только `acknowledgeUpdate`.
- `updateCursor` → `resolveUser` → `claimUpdate`. Completed → ack. Ack делается только после определённого исхода. Неопределённый исход (DEPENDENCY_UNAVAILABLE/INTERNAL_ERROR, сеть) **не подтверждается**: тот же update повторяется с тем же `intentKey` и backoff до 60 с, пользователь получает одно уведомление.
- Ключи идемпотентности: `intentKey(receipt.intentKey, операция, n)` или id доставки.
- Outbox: `claimDeliveries` (run | reminder) → отправка → `completeDelivery` либо `failDelivery(CHAT_UNAVAILABLE | RATE_LIMITED | DELIVERY_FAILED)`. Повторной генерации нет.

## Сценарии

Меню из двух страниц. Режимы understand / say_direct / before_send / thread, каждый шаг — одно короткое сообщение с Назад/Пропустить/Отмена. Своя гипотеза с проверкой цитат или «Не понимаю». Все AI-действия идут одинаково: `createSession` → `createPreview` (маскированная копия от домена) → «Изменить» (`editPreview`, новая revision, старая кнопка устаревает) → «Отправить в модель» (`confirmPreview` по `snapshotHash` → `startRun`). `safety:'support'` → текст `support()` без кнопки отправки.

Результаты: основания по категориям, сравнение, evidence с подписью поля; «Как уточнить?» из сохранённого analysis + clarify-run по запросу; тепловая карта 🟢/🟡/🟠 словами с «Почему? / Мягче»; четыре цели. Есть «Полезно/Не полезно», упражнение, роль с тремя уровнями, счётчиком и ранним завершением, примеры, общая история с фильтром сфер и удалением по revision, прогресс и навыки, практика дня, карточки, тест до/после, напоминания (opt-in, время, IANA timezone, тихие часы), «Открыть веб» (одноразовая ссылка без preview с предупреждением), веб-сессии с отзывом, согласие, почта, удаление данных и аккаунта.

## Проверки

`npx tsx --test apps/bot/test/*.test.ts`: mock Telegram (поддельный fetch) и test-only `FakeProduct` по контракту v2. Root `npm test` гоняет их вместе с domain/web DB-тестами Димы. Реальный test bot, БД, SMTP и модель не проверялись.

## Пробелы контракта (для Антона)

Состояние ниже держится в памяти процесса (это навигация, не учебные данные); после рестарта бот просит повторить шаг:
- `challengeId` почты (нет в `DialogueV2`/`ComposerDraft`);
- выбранное для правки поле preview;
- говорящий для следующей реплики ветки;
- id карточки для попытки;
- поле напоминаний, которое сейчас редактируется;
- ответы теста до/после: в контракте нет частичного сохранения, отправляются одним `submitAssessment`;
- курсоры истории.

Ветка поддерживает добавление по порядку и удаление последней реплики; перестановки и правки отдельных реплик нет. Страна для `support()` пока фиксирована: `RU`.
