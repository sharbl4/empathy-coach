# Deploy и статус доступов

Основная площадка — облако организаторов; параметры и доступ пока не предоставлены. Публичного staging URL нет.
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
| GitHub | connector подтвердил sharbl4; CLI repo/workflow авторизован. Результат создания repo и CI фиксируется в handoff |
| Supabase | project URL/key не заданы; создать/выбрать dev/test/prod проект, настроить env |
| DB | Docker daemon не запущен; production DATABASE_URL не предоставлен; включить daemon или выдать managed DB |
| Auth redirects | после выдачи HTTPS URL задать Site URL и allowlist callback/recovery (dev отдельно) |
| Регистрационные письма | проверить нового внешнего получателя, spam/лимиты; при необходимости SMTP |
| Recovery | проверить письмо, переход на allowlisted URL, update password и повторный вход |
| GigaChat | credentials/scope/model/base URL не заданы; Дима проверяет официальный v1/v2 формат и первый live JSON |
| Hosting | получить доступ и параметры от организаторов; публичная публикация пока заблокирована |
| Приглашения | нужны подтверждённые GitHub-логины Димы/Дани; приглашения не отправлены |

Не выводить значения env, токены и письма в отчёт. Проверка наличия SDK не подтверждает настроенный аккаунт или бюджет.
