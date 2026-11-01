# Runbook: один app, PostgreSQL, HTTPS, домашняя модель

Решение31.10.2026 web+Telegram заменяет Telegram-only. Команды ниже подготовлены для Linux Docker Compose; на QQCloud пока НЕ выполнялись. Полный build заблокирован B1/B2/C1. Секреты/старые .env/IDE не перезаписывать.

## До установки

Получить у организаторов: ОС/SSH; постоянный процесс и диск; Docker или совместимый container runtime; RAM/CPU/disk; исходящий Telegram/SMTP/Tailscale; входящие80/443; backup; подтверждённую страну DC. Бот привязки доменов не подтверждает VM/Docker. Уточнить условия обработки QQCloud, Telegram, SMTP и домашнего ПК для публичного запуска. Документы о прежнем Supabase/GigaChat не подтверждают соответствие новой системы закону.
Отдельные dev/test/prod DB, bot tokens, три независимых auth/code secrets. Не связывать старые аккаунты по email. Сохранить все применённые миграции/данные.
Установить Docker Engine/Compose plugin по официальной инструкции для выданной ОС. Проверить collision subnet172.30.23.0/29 с host/Tailscale routes; при collision согласованно поменять сеть, три адреса и TRUSTED_PROXY_IPS. Пример CIDR не факт облачной сети.

## Сборка и secrets

На ПК/CI: npm ci; npm run lint; npm run test:contracts; npm run build; npm run typecheck; реальные DB/browser tests из CI. docker build -t <registry/image:immutable-commit> .; push после авторизации владельца. На VM не собирать.
Создать закрытый каталог, env с chmod600 и заполнить поля .env.example вручную. Deploy добавляет PG_PASSWORD, APP_IMAGE immutable tag/digest; DATABASE_URL с private db:5432, password URI-encoded; WEB_ORIGIN ровно https://фактический-домен без path. Значения в чат/логи не выводить.
EMAIL_CODE_SECRET, WEB_SESSION_SECRET, WEB_LINK_SECRET — разные random32bytes hex. Не выводить генерацию в терминал с записью экрана; записать непосредственно в secret store/env. LOCAL_LLM_API_KEY перенести из endpoint.key приватно. .env приложения не Vite env; VITE_PUBLIC_* только presentation. Старые Supabase/GigaChat поля не попадают в child runtime через root launcher.

## Миграции и первый запуск

Обозначение dc ниже: docker compose --env-file /private/path/prod.env -f compose.production.yaml.
dc pull; dc up -d db. Сделать backup до изменения schema. Затем **dc run --rm --no-deps app node apps/api/dist/db/migrate.js**: это только мигратор, без polling/HTTP. Не применять новые миграции, пока Дима не поставил/проверил их на отдельной test DB.
dc up -d app proxy. Никогда не scale app; один poller фактического botId и DB lease. Dev/test процесс с production token предварительно остановить. Telegram conflict409 — проверить другие машины, не очищать inbox/offset.
DNS A/AAAA указывает на реальный сервер (не оставлять нерабочий AAAA). Caddy2.11.7 принимает80/443 и получает сертификат; актуальный WEB_ORIGIN обязателен. Не публиковать3000/5432/8080. PG только bridge, модель только Tailnet IP. Проверить публичные HTTPS chain/redirect, web auth callback/Origin, Secure HttpOnly SameSite=Lax __Host- cookies, отсутствие wildcard CORS.
Fastify доверяет только172.30.23.2. Внешний X-Forwarded-For не identity; доступ к app напрямую отсутствует. Если площадка имеет собственный proxy — сначала проверить его точные адреса/forwarding, не ставить trustProxy=true.
Caddy access/error URL logs отключены; Docker logging none. Приложение пишет только allowlisted безопасные коды/метрики, никогда URL auth, headers, cookies, payload/SMTP/модельные ответы. Не включать debug для диагностики.

## Health, RAM и очередь

Health требует DB/HTTP/polling/workers/scheduler, heartbeat не старше120s; модель offline не выключает чтение истории/аккаунта/карточек. Docker restart срабатывает при завершении процесса; одна только unhealthy отметка сама не перезапускает контейнер. Domain shutdownSignal/lease loss/polling finished обязаны завершать общий процесс.
Shutdown: stopAccepting, polling/HTTP close, drain/abort workers/model, DB/pool/leases close; общий deadline110s, compose grace120s. Partial start освобождает уже открытые ресурсы.
Начальные caps app640MiB/db512MiB/proxy64MiB, pg pool5, max_connections20, shared_buffers64MB, work_mem2MB, GPU concurrency1/queue8. Эти caps — гипотеза. Во время одновременных HTTP+polling+напоминаний+модельных запросов выполнить **node scripts/measure-resources.mjs /private/path/prod.env 60** на host, записать workload/N/peak/host available, OOM/restarts/queue latency. Сохранить запас ОС, не объявлять2ГБ достаточными до замеров.

## Backup, restore и rollback

Backup содержит пользовательские данные: закрытое хранилище, шифрование/retention/доступ владельца. В Linux shell в защищённом каталоге с umask077:
dc exec -T db pg_dump -U empathy -Fc empathy > backup.dump
Проверка **в отдельной новой БД**: dc exec -T db createdb -U empathy empathy_restore_test_20261031; dc exec -T db pg_restore --exit-on-error -U empathy -d empathy_restore_test_20261031 < backup.dump.
Проверить schema/migration versions, row counts/constraints и synthetic read без вывода содержимого. Никогда не restore поверх production. Сделать новую restore-test DB для нового прогона; не использовать --clean против production.
Update: сохранить предыдущий APP_IMAGE/schema version/backup; dc stop app; миграции; указать новый immutable image; dc up -d app proxy; проверить health/checkpoint. При совместимой additive schema вернуть предыдущий image. При несовместимой — остановить app и согласовать отдельную восстановленную DB; не переписывать применённые migration и не делать blind down.
Stop: dc stop app proxy db. Не выполнять down -v: pgdata постоянный. После host reboot проверить persistent disk/volumes, health, ровно один poller, HTTPS, shared history; не считать restart policy доказательством.

## Домашний ПК и live-приёмка

[local-model.md](local-model.md): владелец запускает другую Windows машину, принимает Gemma terms, проверяет драйвер/VRAM, устанавливает два кандидата, firewall/ACL и endpoint key. По отдельному согласованию отключает сон на время демо и затем возвращает прежний режим. Не менять power policy автоматически.
После reboot вручную убедиться в Tailscale login, адресах, firewall, start model и getHealth; auto-start задания добавлять только владельцем, без второго server.
С чужого телефона: Telegram→QQCloud→реальная модель; затем веб one-time login в тот же аккаунт→та же история; изменения/прогресс туда-обратно; два пользователя изолированы. Restart сохраняет историю. Offline PC оставляет read path, generation завершается понятной ошибкой без retry/fixtures. Затем весь раздел7.


## Инцидент test inbox, 01.11.2026

На финальном test stack обнаружены старые processing/retry_wait receipts: новые claim возвращали OPERATION_IN_PROGRESS, bounded poller завершался после5 исходов без durable record. Это корректная ограниченная остановка, но не исправление причины зависшего receipt. Не отключать guards/лимиты, не запускать второй poller и не повторять неопределённую генерацию.

До операторского исправления: остановить только test app, проверить pending model runs=0, сохранить pg_dump в закрытом каталоге с0600, проверить точный test DB/число/возраст receipt. Нужна явная авторизация владельца на terminal failure неоднозначного действия. В этом инциденте разрешены ровно2 receipt возрастом>5мин в between_stage4_test_5292; они отмечены failed/INTERNAL_ERROR и сняты только связанные user_update_slots. Attempts не переписаны, cursor не двигался вручную, intents/аккаунт/сессии/runs не удалялись и не менялись. Бэкап восстановлен отдельно до этого; свежий pre-recovery dump сохранён на VM.

После старта штатного app проверить health, отсутствие restart loop, историю и отдельный новый preview/intent. Старый failed receipt не превращать в success и не выдавать такой operator recovery за автоматический кодовый fix. Воспроизведение потерянной повторной доставки/offset остаётся отдельным открытым gate. Не читать raw Telegram payload или model output для диагностики, не делать docker attach с сырым захватом; использовать только технические коды в источнике. Непроверенный direct smoke во время restart loop не засчитывать и автоматически не повторять.
