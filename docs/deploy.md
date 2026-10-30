# Deploy и статус доступов

Основная площадка — облако организаторов; параметры и доступ пока не предоставлены. Антон подтвердил отложить публикацию до получения доступа и продолжать локальную разработку. Публичного staging URL нет.
Sites рассмотрен: Cloudflare Workers не поддерживает выбранный постоянный Fastify-процесс и raw pg TCP. Перенос туда потребует отдельного решения по архитектуре, поэтому стек сохранён.

До staging Антону нужно получить: VM/постоянный контейнер, способ deploy (GitHub/image/SSH), HTTPS hostname, PORT, secrets UI, лимиты CPU/RAM/lifetime, egress к Supabase/GigaChat/token endpoint, DB/backup/connection limits и правила внешней БД.
Serverless без поддерживаемых background jobs не подходит для текущих runs.
Не покупать платные ресурсы автоматически.

Команды release после готовности мигратора:

```sh
npm ci
npm run build
npm run db:migrate
docker build -t empathy-coach:<commit> .
```

Миграции один раз как release job с DATABASE_URL, затем один runtime контейнер на 0.0.0.0:$PORT.
Reverse proxy обеспечивает HTTPS; /api/health/live для liveness, /api/health/ready для DB readiness (без вызова модели).
Откат: вернуть предыдущий image tag/commit; разрушительный down SQL не выполнять. Перед миграцией backup, совместимость схемы проверить.
Секреты — в hosting env. На сборке web доступны только публичные VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY: передать одноимёнными Docker --build-arg. Административные ключи запрещены. Изменения публичного Auth config требуют rebuild.

| Доступ | Статус / следующий шаг |
|---|---|
| GitHub | [sharbl4/empathy-coach](https://github.com/sharbl4/empathy-coach) создан private; main/feat/foundation отправлены, Actions работают |
| Supabase | project URL/key не заданы; создать/выбрать dev/test/prod проект, настроить env |
| DB | локальные Docker/PostgreSQL запущены, SELECT 1 успешен; app.sessions отсутствует — ждём миграции Димы. Production DATABASE_URL не предоставлен |
| Auth redirects | после выдачи HTTPS URL задать Site URL и allowlist callback/recovery (dev отдельно) |
| Регистрационные письма | проверить нового внешнего получателя, spam/лимиты; при необходимости SMTP |
| Recovery | проверить письмо, переход на allowlisted URL, update password и повторный вход |
| GigaChat | credentials/scope/model/base URL не заданы; Дима проверяет официальный v1/v2 формат и первый live JSON |
| Hosting | получить доступ и параметры от организаторов; публичная публикация пока заблокирована |
| Приглашения | zar1xxx и D1nch1k приняли, push=true у обоих; pending invitations нет |

Не выводить значения env, токены и письма в отчёт. Проверка наличия SDK не подтверждает настроенный аккаунт или бюджет.

## Подготовленный VM/container шаблон

compose.staging.yaml не создаёт хостинг: он запускает один заранее собранный image, слушающий за HTTPS reverse proxy. Хостовый порт привязан к loopback; TLS/домен настраиваются средствами выданной площадки. Для платформы без Docker Compose использовать тот же Dockerfile, PORT/env и release migration job.
После получения доступа и готовности модулей:

1. Задать реальный APP_ORIGIN=https://<выданный hostname>, DATABASE_URL и остальные server env на хостинге; публичные Supabase значения передать build args.
2. Собрать образ с тегом точного проверенного commit и записать его в APP_IMAGE. Никогда не использовать плавающий latest для отката.
3. Проверить шаблон: `docker compose -f compose.staging.yaml config --quiet`. Не выполнять `config` без --quiet: он может вывести секреты.
4. Backup БД; `docker compose -f compose.staging.yaml run --rm app node scripts/migrate.mjs` — один release job после review миграций. Пока мигратора нет, release блокируется.
5. `docker compose -f compose.staging.yaml up -d app`; проверить readiness, HTTPS и SPA refresh.
6. Настроить фактические Auth redirects по docs/services.md; выполнить checkpoint:live против HTTPS origin, затем UI, email delivery/recovery, restart и изоляцию двух пользователей.
7. Откат приложения: APP_IMAGE=предыдущий проверенный image, повтор up -d. Не удалять volumes, не откатывать SQL разрушительно.

Шаблон не подтверждает готовность облака или live-сервисов. Foundation readiness проверяет только SELECT 1, не миграции и не модель.
