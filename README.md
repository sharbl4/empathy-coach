# Между строк

Foundation v0.1.0 для полной v1 по [hackathon-prompts.md](hackathon-prompts.md).
В main приняты foundation, серверное хранение, runs/GigaChat и учебные API. Веб-аккаунты проходят отдельное review; живой вход пользователя и результат генерации не считаются проверенными. OAuth/список моделей и подключение к сервисам проверены отдельно, это не полный live-путь.

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
Для release используйте корневой `npm run build`: web собирается с явным NODE_ENV=production даже при dev .env или test CI. CI дополнительно передаёт VITE_API_MODE=fixtures и проверяет, что fixture-адаптеров нет в production артефактах и регистрации. Это не проверка живой регистрации/писем.
После build `npm run db:migrate` запускает принятый мигратор Димы с .env: checksum истории, advisory lock и транзакции. Для DB-тестов нужны NODE_ENV=test и отдельный TEST_DATABASE_URL, отличный от DATABASE_URL. В CI DB-тесты обязательны; локальный skip не является DB-проверкой.

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

Настройка Supabase Auth/SMTP, GigaChat и локальная контрольная точка: [docs/services.md](docs/services.md).
`npm run services:check` проверяет доступность без генерации; `npm run checkpoint:live` — явный live-путь после готовности модулей и dev/test env. Foundation CI не подтверждает этот путь.
Эти команды, а также root dev/start используют launcher: CA из NODE_EXTRA_CA_CERTS применяется при старте дочернего Node. Если для GigaChat нужен официальный CA, укажите абсолютный локальный путь в .env; настройка описана в docs/services.md. Access token вручную не задаётся.
