# Между строк

Telegram-тренажёр понимания чувств в переписке. Хакатон «Город героев», тема «Чувствовать».

Решение Антона 31.10.2026 заменяет web/Supabase/GigaChat runtime: только личные Telegram-чаты. QQCloud 1 CPU/2 ГБ: один Node-процесс bot+domain и PostgreSQL. Модель на другом домашнем Windows-ПК через закрытую сеть. Нет сайта, Mini App и внешнего inference API.

Node 24.22.1 LTS, npm workspaces, TS, Zod и pg сохранены. packages/contracts/domain — общая фасада; apps/api — библиотека, apps/bot — transport. apps/web и старые HTTP-адаптеры архивные. Миграции/данные сохраняются.

Первый contract commit: 860cd33de38af8baa25fb770e7757d9421ca85d1. [Дима #15](https://github.com/sharbl4/empathy-coach/issues/15) реализует фасаду/миграции; [Даня #16](https://github.com/sharbl4/empathy-coach/issues/16) — bot. Отправленная задача не означает принятия контракта. Пока createDomain/entry отсутствуют, integration build должен блокироваться явно.

## Команды

```sh
npm ci
npm run test:contracts
npm run lint
npm run typecheck
npm run build
# Fill current .env locally; separate test bot/database mandatory.
docker compose up -d db
npm run db:migrate
npm run dev
npm start
```

Contracts всегда первым; release build только contracts/api/bot. dev/start не запускают Vite/Fastify. Старый личный .env автоматически не перезаписывается. Секреты заполнить локально по актуальному .env.example.

services:check проверяет PG/getMe/webhook без polling/генерации. model:check -- --requests 10 выполняет явные синтетические генерации; это не E2E. test:legacy сохраняет прежние HTTP/model adapter тесты, не подтверждает новый runtime.

На доступном ПК только Intel Graphics, nvidia-smi/Tailscale не найдены. RTX находится на другом ПК владельца; модель/VRAM/QQCloud/закрытая сеть здесь не проверены.

[Runbook](docs/runbook.md), [архитектура](docs/architecture.md), [фасада](docs/domain-contract.md), [приёмка](docs/acceptance.md), [модель](docs/local-model.md), [демо](docs/demo.md). [Правовые документы](docs/legal/README.md) требуют обновления/утверждения под новые потоки; private network не доказывает выполнение 152-ФЗ.
