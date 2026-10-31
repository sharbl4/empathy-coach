# Актуальные сервисы

31.10.2026: только Telegram Bot API (transport), PostgreSQL, SMTP и приватный Windows llama.cpp. Supabase/GigaChat больше не runtime; [старые настройки](archive/web-services.md) — архив. Старый личный .env не перезаписывается, его секреты не печатаются и не передаются новому container env.

Поля: NODE_ENV, DATABASE_URL, TELEGRAM_BOT_TOKEN, AI_PROVIDER=local, LOCAL_LLM_BASE_URL, LOCAL_LLM_MODEL, LOCAL_LLM_API_KEY, AI_TIMEOUT_MS, AI_MAX_CONCURRENCY, SMTP_HOST/PORT/USER/PASSWORD/FROM, EMAIL_CODE_SECRET. Точные имена/границы — RuntimeEnvironment в @between/contracts/domain. Production модель — numeric Tailscale IP /v1, не публичный inference endpoint.

Отдельный test bot и disposable test DB обязательны. TEST_DATABASE_URL задаётся только в среде запуска тестов, не production runtime example. Telegram token создаёт/настраивает владелец через официальный @BotFather; webhook должен отсутствовать перед long polling, существующий webhook не удалять молча. getMe подтверждает реального бота, но не выдаёт права на чужие user IDs.

SMTP подтверждает фактическую доставку пользователю; TCP/наличие пароля недостаточны. Код HMAC/TTL/attempt/resend/одноразовость реализует Дима; письмо не содержит переписки. Отказ SMTP не подтверждает адрес. Владелец задаёт пароли только локально/в hosting.

services:check не делает генерацию и не запускает poller. model:check явно генерирует синтетические запросы и пишет только агрегаты; перед реальным запуском сообщить об этом. Запуск, сеть, recovery/backup/rollback — [runbook](runbook.md).
