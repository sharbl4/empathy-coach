# Передача foundation

Исходный контракт: packages/contracts 0.1.0. Антон принял foundation как основу; Дима начинает feat/api-storage, Даня — feat/web-account. SQL/зависимости ещё требуют review Димы, согласование за участников не заявляется.
Рабочая ветка feat/foundation. Точный стартовый commit — HEAD ветки после передачи; финальный отчёт содержит полный SHA.

Дима: сначала review docs/architecture.md и contracts. Подтвердить SQL, pg 8.16.3, Supabase 2.76.1 и retry-семантику Антону. Затем apps/api: migrations, Auth getUser, ownership, CRUD, runs и GigaChat. Мигратор в src/db/migrate.ts. Не менять контракт/lockfile без Антона. Тесты с отдельной БД; добавить product CI gate после реализации.

Даня: apps/web от того же commit. Импортировать схемы/типы @between/contracts, фикстуры @between/contracts/fixtures только для тестов и явно обозначенного dev. Auth через Supabase SDK, API Bearer, pending polling 1–2 сек с отменой, idempotency UUID на намерение, revision conflict. Никаких локальных копий DTO и скрытого mock.

Антон: получить параметры облака и env без передачи секретов в чат; staging контейнер/HTTPS; Supabase redirects/почта/recovery; подтверждённые логины для приглашений. Не считать принятым контракт до реального review.

## Проверенные результаты

Базовый код: `44202fb9e7f3044c245c2b0196705d4e03eb0e54` в main и feat/foundation.
Локально: чистое npm ci, lint, typecheck, 8 тестов, production build; npm audit — 0 уязвимостей.
Dev Vite HTTP 200, proxy /api/health/live → ok, readiness без DB → 503.
Локальный Playwright заблокирован загрузкой Chromium (ECONNRESET/ENOTFOUND); сам backend при E2E стартовал.
[GitHub Actions baseline](https://github.com/sharbl4/empathy-coach/actions/runs/41066279765): прошли npm ci/lint/typecheck/test, Playwright, Docker build и HTTP/readiness контейнера с PostgreSQL.
db:migrate проверен: exit 1 с точным сообщением о недостающем миграторе, миграции не считаются выполненными.
Локальный Docker daemon выключен; контейнер проверяется в CI.
Зависимости pg/Supabase и SQL требуют review Димы; контракт не объявлен принятым за участников.
Приглашения D1nch1k и zar1xxx с write-доступом отправлены. Принять их перед clone.
Публикация отложена по указанию Антона до получения облачного доступа; никакой localhost не является staging.

```sh
git clone https://github.com/sharbl4/empathy-coach.git
cd empathy-coach
git switch main
git switch -c feat/api-storage
# Даня вместо последней строки: git switch -c feat/web-account
npm ci
```

Обоим сначала прочитать AGENTS.md и docs. Любое предложение изменить v0.1.0 направить Антону до реализации.

## Текущая интеграционная контрольная точка

Реальный вход → сохранение ситуации в PostgreSQL → анализ GigaChat → повторное открытие результата после logout/login. Настройки и команды: [services.md](services.md).
zar1xxx и D1nch1k приняли приглашения (push=true у обоих). Storage PR #1 проверен на отдельной PostgreSQL и возвращён с request changes: ошибочные status/envelope в дочерних routes. Подробности в review PR.
Облако не блокирует локальную интеграцию. HTTPS-проверка того же пути — после выдачи доступа. Зелёный foundation CI не подтверждает миграции/Auth/GigaChat.
