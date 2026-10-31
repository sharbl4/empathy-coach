# Telegram transport

Даня реализует src/main.ts и сценарии по issue #16. Workspace/entry/тип фасады закреплены интегратором; пустой transport не подменяется mock-ботом. Missing main.ts или createDomain — блокирующая ошибка integration build.

Вызывать @between/api.createDomain напрямую; DTO из @between/contracts/domain. Один poller, private only, stable intents, graceful stop. Обновлять BOT_HEALTH_FILE атомарно безопасным BotHealth без ID/текста/токенов не реже 30 секунд, в том числе во время ожидания модели; database/pollerLease/polling отражают фактический статус. После остановки polling heartbeat не продлевается. Модель offline не причина скрыто подменять ответ.
