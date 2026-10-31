# Архитектура Telegram-only

Решение Антона 31.10.2026 заменяет React/Fastify HTTP/Supabase/GigaChat. [Архив](archive/web-architecture.md) не инструкция запуска.

```text
Telegram getUpdates (TLS, private chats)
  → apps/bot transport/scenarios, один Node-процесс QQCloud
    → @between/api.createDomain (in-process)
      → PostgreSQL accounts/dialogue/sessions/runs/learning
      → Tailscale → Windows llama.cpp /v1/chat/completions
    → SMTP для подтверждения email
```

Нет Redis/сервиса очередей/публичного HTTP backend. apps/api — библиотека, импорт не запускает сервер. Production содержит только bot/domain/миграции; web/Fastify/Supabase/hosted inference исключены из runtime graph.

Principal — доверенный Telegram sender, не callback data/username. Domain-issued UserContext связывает telegram_user_id BIGINT с внутренним UUID; DTO ID — decimal string. TS brand не защита: проверяются issuer/выданный объект и актуальная запись аккаунта/consent/email. Каждый session/run/roleplay ID ограничен владельцем/revision.

Дима добавляет новые миграции accounts/challenges/consents/dialogue/update intents. Старые profiles/sessions/ai_runs/roleplays/messages/practice_events, применённые миграции и данные сохраняются. Старые UUID нельзя автоматически связать по email/имени.

Сигнатуры: [domain-contract.md](domain-contract.md). Записи идемпотентны по owner+operation+resource+UUID и canonical validated payload, конкурентность обеспечивается SQL. Повтор update/неопределённый исход сохраняет intent, не создаёт второй run. У dialogue своя revision; transport не передаёт готовые анализы/историю модели.

Один poller на фактический botId: DB advisory lease до getUpdates, при потере lease polling прекращается. Runs тоже удерживает lease; начальная цель pool max=5 учитывает обе связи и требует замера. AI concurrency=1. Генерация вне SQL-транзакции. Interrupted pending → RUN_INTERRUPTED, нет автоматического retry.

Только AI_PROVIDER=local, private LOCAL_LLM_BASE_URL. Ограничены timeout/input/output/context; большой input отклоняется, не обрезается молча. Strict schema/evidence validation; reasoning/незавершённый output не становятся succeeded и не показываются. Удалённые данные/старая revision не восстанавливаются поздним output.

QQCloud: bot512MiB + DB512MiB, CPU0.65/0.25 и запас ОС при 2GiB — начальная гипотеза, не замер. Модель на VM не запускается; image собирается в CI/на ПК. Windows слушает только Tailscale IP:8080. ACL cloud tag→model tag tcp8080, firewall — конкретный cloud IP/порт/программа. API key дополнительно, не вместо сети. Роутер/firewall не отключать; direct/relay измерять фактически.
