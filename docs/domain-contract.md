# Telegram domain boundary 1.0.0 · 31.10.2026

Источник DTO и **точных сигнатур**: `packages/contracts/src/domain.ts`, экспорт `@between/contracts/domain`. Версия нового протокола — TELEGRAM_CONTRACT_VERSION=1.0.0; версия npm-пакета пока сохраняется для совместимости сохранённого архивного кода. Старые HTTP api/Me — архив, не новый transport.

Дима реализует `export const createDomain: CreateDomain` из `@between/api`; импорт ничего не запускает и не импортирует Fastify/Supabase/GigaChat. Даня запускает единственный процесс apps/bot, получает getMe и getUpdates, создаёт домен и вызывает методы напрямую. Сигнатуры CreateDomain/DomainOptions/DomainFacade общие, локальных копий DTO нет. Согласование с Димой пока запрашивается; отсутствие ответа не считается принятием.

## Контекст доверия

Transport получает from.id только из результата собственного getUpdates. Callback sender — callback_query.from, chat — callback_query.message.chat; только chat.type=private и совпадение chat.id/from.id. Username и callback data никогда не источник владельца. Числа Telegram проверяются как safe integer до преобразования в строку. На границе и в pg BIGINT — десятичные строки; uuid accountId остаётся внутренним PK для сохранения старых таблиц и данных.

resolveUser(identity) создаёт/находит подтверждённую в БД связь telegram_user_id UNIQUE → account UUID и возвращает непрозрачный UserContext. TS brand не защита сам по себе: фасада хранит выданные контексты в WeakSet/эквиваленте, отвергает подделку и повторно проверяет актуальное состояние аккаунта/согласия при работе. Открытого HTTP resolveUser нет. Тестовый issuer допустим только как явный test-only адаптер с отказом в production.

Account/consent/email/dialogue доступны до email verification в необходимом минимальном объёме. Учебные методы требуют актуальных согласия telegram-1 и подтверждённого email; иначе CONSENT_REQUIRED/EMAIL_NOT_VERIFIED. Согласие telegram-1 — ID будущей утверждённой редакции, не заявление, что текст уже принят или опубликован. При отзыве нельзя запускать новые генерации; удаление и обращения остаются доступны.

## Аккаунт и почта

resolveUser → account → acceptConsent → requestEmailCode → verifyEmailCode → onboarding. Email никогда не используется как владелец аккаунта. Код: 6 цифр, 10 минут, не более 5 попыток, resend не раньше 60 секунд; дополнительно лимиты на пользователя и адрес. Код хранится HMAC с EMAIL_CODE_SECRET, привязан к account/challenge/purpose, одноразовый и конкурентно потребляемый. Никаких кодов/адресов в логах. SMTP отказ не подтверждает почту. Данные аккаунта не содержат сам код или секрет.

## Диалог и учебные операции

Dialogue хранится в PostgreSQL, имеет собственную revision. Transport не сохраняет истории модели и готовых результатов: только разрешённый DialogueDraft. Каждая ссылка session/run/roleplay проверяется по accountId. pendingRunId задаёт сервер. Редактирование со старой revision — REVISION_CONFLICT. История/пагинация, упражнение, роль с тремя ответами/ранним завершением, прогресс и удаления сохраняют прежнюю доменную семантику.

Антон уточнил «Сказать прямо»: помочь выразить **свои чувства и потребности**. `sayDirect(ctx, sessionId, {expectedRevision, feeling, need, request, draft?}, key)` создаёт run kind=say_direct; вывод: observation/feeling/need/request/message/explanation по SayDirectOutput. Это отдельная учебная механика, без приписывания эмоций собеседнику. Модель получает server-owned ситуацию текущей revision и собственный ввод пользователя; не диагноз. Результат сохраняется в runs, валидируется до succeeded, входит в DomainSessionDetail. Сценарий начинается с создания ситуации (guess.unsure=true допустимо), не требует анализа чужих эмоций заранее.

## Идемпотентность, ошибки, восстановление

UUID key обязателен для всех записывающих методов. Область ключа: account + операция + ресурс; hash включает нормализованный валидированный ввод. Тот же ключ/данные возвращает прежний результат, другой ввод — IDEMPOTENCY_CONFLICT. Конкурентные вызовы проверяются в БД. Telegram повторный update сохраняет одно намерение: стабильный UUID хранится до неопределённого исхода и после restart. Повтор сообщения/кнопки не создаёт второй run. Не повторять генерацию автоматически после timeout/неопределённого завершения.

Чужие/удалённые ссылки — NOT_FOUND без раскрытия владельца. DomainFailure содержит безопасный code/requestId, без сырых ошибок, email и контента. Локальная модель недоступна → failed MODEL_UNAVAILABLE/MODEL_TIMEOUT, пользователь получает понятное сообщение, фикстуры и внешние API не подставляются. Изменение/удаление данных исключает сохранение позднего ответа. Interrupted pending после restart → RUN_INTERRUPTED.

Один poller на bot ID: DB advisory lease до первого getUpdates, удерживается выделенным соединением, при потере lease polling прекращается. Runs и poller могут использовать отдельные lease в одном процессе. close() останавливает polling/новые задачи, закрывает runs и pool. Конкретные ресурсы — часть интеграционной проверки, не гарантия по лимитам compose.

Для transport bookkeeping фасада предоставляет updateCursor(), claimUpdate(ctx,updateId) → UpdateReceipt(intentKey,status), acknowledgeUpdate(updateId). Они доступны только доверенному poller с действующим lease, не как публичные callbacks. Отклонённые group/channel updates продвигают offset без создания аккаунта/сохранения контента. Private processing получает прежний stable intentKey после restart; completed не повторяет доменные действия. Отправку Telegram нельзя объявлять exactly-once: при неопределённом send исходе не перезапускать генерацию. shutdownSignal прерывает getUpdates при потере lease/close. BotHealth/BOT_HEALTH_FILE определяют единственный private heartbeat; модель offline не подменяется здоровым ответом.
