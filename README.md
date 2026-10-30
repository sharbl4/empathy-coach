# Между строк

Foundation v0.1.0 для полной v1 по [hackathon-prompts.md](hackathon-prompts.md).
Это запускаемый технический каркас; продуктовые Auth/CRUD/AI/практика пока не реализованы.

Node 24.22.1 LTS (`.nvmrc`), npm workspaces. Точные зависимости и транзитивные версии — package-lock.json.

```sh
npm ci
cp .env.example .env
docker compose up -d db
npm run dev
```

В PowerShell вместо cp: `Copy-Item .env.example .env`. Web: http://localhost:5173; API: http://localhost:3000.
Vite проксирует /api; production Fastify отдаёт web/dist с одного origin.
Не заполняйте env секретами в Git. Пустые Supabase/GigaChat настройки означают отсутствие подключённых сервисов.

```sh
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run e2e
npm run build
npm start
```

Contracts всегда собирается первым. E2E проверяет браузер и настоящий HTTP технического каркаса, не полную v1.
`npm run db:migrate` намеренно завершится ошибкой до реализации мигратора Димой; это не заглушка успеха.
Дима создаёт `apps/api/src/db/migrate.ts`; после build скрипт запускает его с .env.

```sh
docker build -t empathy-coach:foundation .
docker run --rm --env-file .env -p 3000:3000 empathy-coach:foundation
```

В контейнере DATABASE_URL должен указывать на доступную внешнюю БД, не localhost.
Подробности: [контракт](docs/api.md), [архитектура и SQL](docs/architecture.md), [приёмка](docs/acceptance.md), [деплой и доступы](docs/deploy.md), [передача](docs/handoff.md).

Основной хостинг — облако организаторов. Публичный staging URL пока не предоставлен.

В текущей Windows-папке Node скачан с nodejs.org и проверен по официальному SHA256; переносимая копия игнорируется Git. Для этой копии перед командами:

```powershell
$env:Path = "$PWD\.tools\node-v24.22.1-win-x64;$env:Path"
npm.cmd run dev
```

В новом clone установите Node версии `.nvmrc`. Private GitHub: https://github.com/sharbl4/empathy-coach.
