# Доступы web + Telegram v2

Supabase/GigaChat больше не runtime, прежние инструкции заменены. Реальный .env не перезаписывается и не печатается. Поля актуального окружения — .env.example и RuntimeEnvironmentV2.

Нужны: test Telegram bot (создаёт владелец), отдельная test DB; SMTP host/port/user/password/from и подтверждённый sender; code secret и два независимых session/link secrets; actual WEB_ORIGIN; модельный endpoint private IP/model alias/key; QQCloud SSH/persistent disk/Docker/DNS80/443. Секреты только локальный env/hosting.
Supabase built-in mail теперь не используется. Для email verification нужен настоящий SMTP: проверить sender domain SPF/DKIM/DMARC, sandbox recipient restrictions, доставку/спам, TTL/cooldown/attempt cap; никакого кода в логах. До живого SMTP это непроверено.
npm run services:check делает только PG SELECT1 и Telegram getMe после полной env validation. Polling/SMTP/inference этим НЕ подтверждаются. npm run model:check требует явного --allow-generation; запуск владельцу сообщается заранее.
Браузер использует same-origin /api и cookie-session; bot token/DB/endpoint key/secrets никогда VITE. Dev Vite на5173 проксирует /api к3000. Production через HTTPS, exact origin, не wildcard CORS.
