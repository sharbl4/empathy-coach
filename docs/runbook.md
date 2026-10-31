# Runbook QQCloud + домашний Windows

31.10.2026. Инфраструктура подготовлена как кандидат; cloud access, домашний GPU, Tailscale, SMTP и test bot не предоставлены для реального прогона. Полный запуск зависит от #15/#16. Не считать команды ниже уже выполненными на QQCloud.

## 1. До установки

Подтвердить фактический дата-центр/условия обработки QQCloud и домашнего ПК, права оператора/SMTP/Telegram, retention и backup. Настроить отдельный test bot и test DB; production token не использовать для разработки. Политика/согласие требуют актуализации под Telegram-only и утверждения до публичного сбора.

На выданной VM проверить cat /etc/os-release, свободный диск, RAM/CPU и SSH-доступ. Установить поддерживаемый Docker Engine/Compose plugin по официальной инструкции для её ОС; не собирать модель/образ на VM2GB. SSH доступ владельца не перекрывать при настройке provider firewall. Внешние порты приложения/PG не нужны. Tailscale и model setup — [local-model.md](local-model.md).

## 2. Build и секреты

После интеграции фасады/transport и зелёного CI на ПК:

```sh
npm ci
npm run build
docker build -t between-telegram:<verified-commit> .
docker save -o between-telegram.tar between-telegram:<verified-commit>
```

Перенести проверенный tar по SSH, сверить SHA256, docker load -i between-telegram.tar на VM. Либо использовать согласованный private registry и immutable digest. Не использовать latest для отката. CI строит image и проверяет dependency closure; image не публикуется автоматически без настроенного registry.

В hosting env/ignored файле .env.production задать все поля .env.example. Дополнительные deploy-поля: BOT_IMAGE=проверенный тег/digest, PG_PASSWORD=отдельный URL-safe случайный пароль. DATABASE_URL должен указывать на db:5432/empathy внутри compose, пароль URL-encode. Один bot token — один poller; local dev/test не запускают production token. EMAIL_CODE_SECRET — отдельные≥32random bytes hex. LOCAL_LLM_API_KEY переносит владелец из Windows endpoint.key. Никаких значений в Git/chat/argv.

Compose передаёт bot только актуальные параметры явно, не весь старый .env с Supabase/GigaChat. Проверять config только с --quiet, иначе секреты могут попасть в вывод.

## 3. Первый запуск и restart

```sh
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml up -d db
# Review new migrations and take backup first. No automatic destructive rollback.
docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps bot node apps/api/dist/db/migrate.js
docker compose --env-file .env.production -f compose.production.yaml up -d bot
docker compose --env-file .env.production -f compose.production.yaml ps
```

Не scale bot. При намеренном restart сначала stop bot, дождаться release lease, затем up -d bot. Потеря DB lease останавливает poller; Telegram409 — ошибка оператора о втором poller, не повод скрыто обходить lease. Health без HTTP: heartbeat в /tmp/between-bot-health.json, актуальные database/pollerLease/polling, TTL120s и живой PID. Дима/Даня должны реализовать фактическое обновление; наличие health script не создаёт heartbeat само.

При sleep/отключении Windows новая генерация должна завершиться понятной ошибкой, история — сохраниться. Владелец при необходимости сам временно отключает сон на питании от сети на время демо и возвращает прежнюю настройку после; скрипты не меняют power policy. После перезагрузки ПК владелец повторяет Tailscale/status, Start-Model, model probe и доступ cloud→model. После перезагрузки VM проверить PG health, один poller, согласие/email/историю и отсутствие повторной генерации interrupted run.

## 4. Backup / restore

Не использовать --clean/удаление volumes на рабочей БД. Backup сохранять в закрытом российском хранилище по утверждённому сроку/шифрованию; дамп содержит пользовательские данные, в Git/чат его не передавать. Команды на Linux VM (не PowerShell5 redirection для бинарного dump):

```sh
umask 077
docker compose --env-file .env.production -f compose.production.yaml exec -T db pg_dump -U empathy -d empathy -Fc > backup.dump
docker compose --env-file .env.production -f compose.production.yaml exec -T db createdb -U empathy empathy_restore_test
docker compose --env-file .env.production -f compose.production.yaml exec -T db pg_restore -U empathy -d empathy_restore_test --exit-on-error < backup.dump
docker compose --env-file .env.production -f compose.production.yaml exec -T db psql -U empathy -d empathy_restore_test -c 'SELECT count(*) FROM app.schema_migrations'
```

Restore только в новую отдельную БД; затем проверить структуру, количества и выборочную ownership/revision/history через фасаду без второго poller того же token. Повторить удаления, произошедшие после snapshot, до выдачи данных пользователю. Новый restore test name выбирать, не перезаписывать существующую БД. Положительный count не заменяет проверку восстановления функций.

## 5. Ресурсы и ошибки

Начальные caps bot512MiB/db512MiB, max_connections20, shared_buffers64MB/work_mem2MB, AI concurrency1. Pool target5 с учётом lease; Дима фиксирует фактическое значение. Нужен реальный замер docker stats и MemAvailable host под согласованной нагрузкой, peak и запас ОС. При OOM пересмотреть потребление, не считать restart policy исправлением.

Для автоматической выборки на самом Linux-хосте с Node24 (не внутри контейнера): `node scripts/measure-resources.mjs .env.production 30` во время согласованной нагрузки. Отчёт содержит только количество samples, peak bot+db bytes и минимальный MemAvailable, без конфигурации/контента. Сам helper учитывается в памяти ОС; наличие 30 idle samples не подтверждает нагрузку, workloadVerified остаётся false до привязки к реальному прогону.

Контейнерные логи не сохраняются (driver none) для исключения утечек; диагностировать safe health/exit/OOM counters. Не включать raw debug/request/model logs для удобства. Сырые SQL/SMTP/Telegram ошибки пользователю не передаются.

## 6. Stop / rollback / live

stop bot останавливает polling, ждёт close/cancel; DB остаётся с volume. Остановить модель отдельным Stop-Model, firewall не отключать. Rollback: stop bot, вернуть предыдущий совместимый BOT_IMAGE, up -d; SQL вниз не откатывать, volume не удалять. Совместимость новых миграций со старым image проверять до релиза.

Финальный тест с чужого телефона: /start → consent/email → ситуация → гипотеза → LLM → остальные учебные шаги/say_direct → history. Restart bot/DB → сохранённый результат. Отключить model PC → понятная ошибка → восстановить → явный retry. Проверить второй аккаунт/группу/старые callback и отказ постороннему сетевому узлу.

В отчёт только commit/model hash/версия/N/p50/p95/failed/VRAM/RAM/direct-or-relay; никаких текстов/адресов/кодов/токенов. На текущую дату N=0, показатели не измерены, live не пройден.
