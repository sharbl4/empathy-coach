# Настройка сервисов · team lead

Контракт 0.1.0 принят Антоном как основа 30.10.2026. Дима — feat/api-storage, Даня — feat/web-account. SQL и детали адаптера подтверждаются review Димы, не копированием DTO.
Все значения секретов вводятся только в локальный .env или hosting secrets. Их не присылать в чат, PR, screenshot или логи.
Окружения dev/test/prod отдельные. Ниже настраивается dev; production-ресурсы и платные покупки автоматически не создаются.

## GitHub

Private repo: https://github.com/sharbl4/empathy-coach.
zar1xxx и D1nch1k приняли приглашения, GitHub подтверждает push=true у обоих. Список ожидающих приглашений пуст.
Обоим доступен clone; для будущих приглашений — [страница GitHub](https://github.com/notifications/invitations).
Если кнопки нет, проверить текущий GitHub-аккаунт; Антон проверяет pending invitation, а не создаёт дубликат.
Фактический clone/push со стороны Димы проверяется после принятия; приглашение само по себе этого не доказывает.

## Supabase: обязательные значения и действия

1. Войти в Supabase Dashboard самостоятельно. Выбрать существующий dev-проект либо создать dev-проект в доступной организации после проверки тарифа/лимитов. Не менять чужой production-проект.
2. В Connect dialog взять URL проекта и **publishable key**, не secret/service_role; полный список ключей — Settings → API Keys. URL и ключ записать в SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY; те же публичные значения — VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. В браузере только эти публичные настройки; backend использует getUser(token). [Расположение ключей](https://supabase.com/docs/guides/getting-started/api-keys).
3. Authentication → Sign In / Providers → Email: provider enabled; Allow new users to sign up = ON; Confirm Email = ON. Anonymous sign-ins = OFF. Социальные провайдеры/ручное связывание для v1 не нужны. Подтверждение email не отключать ради обхода SMTP.
4. Authentication → URL Configuration для отдельного dev-проекта:

| Настройка | Точное dev-значение |
|---|---|
| Site URL | http://localhost:5173 |
| Redirect URLs | http://localhost:5173/auth/callback |
| Redirect URLs | http://localhost:5173/auth/recovery |
| APP_ORIGIN в server env | http://localhost:5173 |

Team lead фиксирует клиентские пути /auth/callback и /auth/recovery для реализации Даней. Это UI-маршруты, не новые endpoint API. Не разрешать широкие wildcard для production. При использовании 127.0.0.1 вместо localhost добавить соответствующие точные URL либо везде использовать localhost.
При выдаче HTTPS: Site URL = фактический origin; два redirect URL с этим origin, APP_ORIGIN тот же; локальные URL держать только в dev-проекте. Не вводить выдуманный домен.

5. Signup передаёт emailRedirectTo=<origin>/auth/callback; resetPasswordForEmail — redirectTo=<origin>/auth/recovery. Для React SPA в SDK 2.76.1 по умолчанию implicit flow: обработка сессии после ссылки и PASSWORD_RECOVERY — зона Дани. Не смешивать с PKCE/SSR шаблонами без согласования. Recovery завершается updateUser({password}), затем проверяется вход новым паролем. Пароли/fragment callback не логировать.
6. Authentication → Email → SMTP: настроить доступный почтовый сервис — host, port, username, password, sender address и sender name «Между строк». SPF/DKIM/DMARC и подтверждение отправителя выполнить по правилам выбранного провайдера. Пароль SMTP хранится только в Supabase Dashboard; в VITE_* он не нужен. Отключить преобразование/трекер ссылок, если почтовый сервис ломает confirmation URL.
7. Email Templates: проверить Confirm signup и Reset password; использовать штатную ConfirmationURL-ссылку. Если шаблоны уже кастомные, проверить, что они сохраняют redirectTo; не переносить SSR token_hash-шаблон без соответствующего callback обработчика.
8. Стандартный SMTP Supabase ограничен адресами участников организации и небольшим лимитом (на дату проверки docs — 2 письма/час). Он не подтверждает доступность регистрации новому внешнему пользователю. Внешняя доставка требует своего SMTP и фактического теста.
9. Проверить отдельным новым внешним адресом: signup → письмо (включая spam) → подтверждение → login → logout → recovery письмо → новый пароль → login. Не создавать реального пользователя через admin auto-confirm вместо этого теста. Результаты записать как pass/fail без email и токенов.

Источники: [общие настройки](https://supabase.com/docs/guides/auth/general-configuration), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [password Auth](https://supabase.com/docs/guides/auth/passwords), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

## PostgreSQL

Локально: docker compose up -d db. Данные в pgdata, порт только на 127.0.0.1:5432. Dev DATABASE_URL из .env.example. Не выполнять down -v и не пересоздавать чужую БД.
SELECT 1/readiness означает подключение, но не наличие app-таблиц. Мигратор и миграции приняты в storage PR Димы. Проверка: npm run build → npm run db:migrate на пустой test-БД → повтор запуска мигратора → integration tests.
Тестовая БД отдельная; тесты и seed не использовать с production DATABASE_URL.
Если выбран Supabase PostgreSQL: взять строку из Connect. Для постоянного backend — direct при доступном IPv6; при IPv4-only — session pooler. Миграции требуют постоянной SQL-сессии/advisory lock; transaction pooler для этого не выбирать. Проверить TLS/CA, лимиты подключений и доступность из будущего контейнера; TLS не отключать.
app не добавлять в exposed schemas Data API; клиентским ролям нет доступа к учебным таблицам. Конкретные GRANT/FK/индексы входят в review миграций Димы.
Источник: [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres).

## GigaChat: кабинет и server env

1. В кабинете Studio создать/выбрать проект GigaChat API, проверить квоту и разрешённые модели. Подписка на веб-чат не равна API-доступу. Не активировать платные пакеты автоматически. В актуальном quickstart указано: с 01.09.2026 новым клиентам оплата моделей предлагается через cloud.ru. Не считать старый API-пакет/бесплатную квоту доступными по умолчанию; если кабинет предлагает только другой endpoint/тип ключа, сначала согласовать с Антоном и Димой, не подставлять cloud.ru токен в GIGACHAT_CREDENTIALS.
2. Проект → Настройки API → Получить ключ (нужна роль Владелец/Администратор). В GIGACHAT_CREDENTIALS записывается **готовая Base64-строка Authorization Key**, без префикса Basic и без повторного Base64. Не пароль, не client secret отдельно и не краткоживущий access token. Ключ показывается один раз: сохранить локально, не регенерировать используемый командой ключ без необходимости.
3. GIGACHAT_SCOPE задаётся по выданному типу доступа: GIGACHAT_API_PERS — физлица; GIGACHAT_API_B2B — соответствующий пакет ИП/юрлица; GIGACHAT_API_CORP — соответствующий pay-as-you-go доступ. Не угадывать scope.
4. Для нового подключения выбираем REST **v1**: GIGACHAT_BASE_URL=https://api.giga.chat/v1. Токен получается отдельно: POST https://ngw.devices.sberbank.ru:9443/api/v2/oauth. Headers: Authorization Basic из ключа, RqUID UUIDv4; body form-urlencoded scope. TLS проверяется. При необходимости добавить официальный доверенный CA через NODE_EXTRA_CA_CERTS в server runtime, не через NODE_TLS_REJECT_UNAUTHORIZED=0.
5. GIGACHAT_MODEL — точное id из GET https://api.giga.chat/v1/models, доступное этому аккаунту. После заполнения ключа/scope/base URL команда `npm run services:check -- --list-models` выводит только имена доступных моделей, без токена/сырого ответа и без генерации. Выбранное id записать в GIGACHAT_MODEL, затем выполнить обычный services:check. Модель/расход подтверждает Дима первым коротким live-запросом.
6. AI_PROVIDER=gigachat. В v1 POST /chat/completions response_format находится на верхнем уровне: type=json_schema, schema из outputJsonSchema('analysis'), strict=true. v2 имеет другой envelope; его формат не смешивать с выбранным v1. Дима проверяет поддержку конкретной модели и строгого результата.
7. Токен хранится в памяти, обновление single-flight до истечения. Дима проверяет единицы expires_at по фактическому контракту API/закреплённому SDK, не переносит расчёт по памяти от другого провайдера.
8. Один generation/run; timeout/429/отказ/invalid JSON — безопасный failed run без сырого ответа в логах. Не повторять платный вызов автоматически после неизвестного исхода; для нового намерения новый Idempotency-Key. Настроить concurrency/лимиты по реальной квоте.

Источники: [авторизация и адреса](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/gigachat-api), [токен](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-token), [модели](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/get-models), [structured output](https://developers.sber.ru/docs/ru/gigachat/guides/structured-output).
Порядок получения ключа и текущие ограничения подключения: [официальный quickstart](https://developers.sber.ru/docs/ru/gigachat/quickstart/ind-using-api).

## Команды team lead и границы результата

Для Node 24.22.1 корневые команды services:check/checkpoint:live/dev/start загружают .env в launcher и запускают приложение дочерним Node-процессом. Это гарантирует, что NODE_EXTRA_CA_CERTS известен до инициализации TLS. На этой Windows-машине одного `node --env-file=.env` оказалось недостаточно для CA: воспроизведён SELF_SIGNED_CERT_IN_CHAIN.
Для GigaChat скачан официальный PEM из https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt по проверенному HTTPS. Файл находится в игнорируемой .tools; абсолютный локальный путь записан в NODE_EXTRA_CA_CERTS. Системное хранилище не менялось, TLS-проверка включена. На другом checkout CA надо получить самостоятельно по [официальной инструкции](https://developers.sber.ru/docs/ru/gigachat/certificates); в контейнере использовать свой путь/mount, не Windows-путь из dev env.
Для повторной загрузки в PowerShell: `Invoke-WebRequest -Uri 'https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt' -OutFile '.tools/russian_trusted_root_ca_pem.crt'`. Каталог .tools создать, если отсутствует. Проверить, что это X.509 CA с CN Russian Trusted Root CA и актуальным сроком. SHA256 текущего проверенного сертификата: D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31. При обновлении сертификата сверять официальный источник, не применять старый fingerprint вслепую.

```sh
npm run services:check
# После merged API migrations/Auth/runs и заполнения env:
npm run checkpoint:live
```

services:check: SELECT 1, публичные настройки Auth, совпадение публичных env, OAuth + список моделей. Не отправляет письма, не вызывает генерацию, не создаёт таблицы. Ненастроенный сервис → exit 1, без секретных значений.
checkpoint:live: требует CHECKPOINT_LIVE=1, AI_PROVIDER=gigachat, DATABASE_URL, CHECKPOINT_ORIGIN и отдельный подтверждённый dev/test аккаунт CHECKPOINT_EMAIL/PASSWORD в .env. Он создаёт одну вымышленную сессию и выполняет один платный/квотируемый анализ через HTTP, проверяет одинаковый run при duplicate POST, Zod output, строки app.sessions/app.ai_runs в PostgreSQL, logout/login и повторное чтение результата. Данные оставляются для просмотра. Не запускать на production. Ошибки дают stage и exit 1, без body/идентификаторов/секретов.
Это HTTP-проверка, не проверка browser UX и не доказательство доставки email или сохранения после restart. После зелёного checkpoint вручную повторить путь в UI, перезапустить backend, открыть результат снова; затем два аккаунта и чужие ID.
Ни один live-check не входит в обычный CI с секретами. Foundation CI остаётся технической проверкой. Product CI с отдельной test-БД и явно тестовыми адаптерами добавляется после модулей участников.

## Review небольших PR

PR принимается после: diff в зоне автора; DTO из contracts; реальные проверки; нет секретов/log body; ownership всех ссылок и revision/idempotency проверяются сервером; миграции прогнаны на пустой отдельной БД; поведение отвечает acceptance.
Любой ответ 2xx из mock/адаптера не засчитывается как live. Не merge при красном CI или недоказанной миграции, если PR заявляет DB-готовность.
Контракт меняется отдельным явным решением Антона с обновлёнными фикстурами/docs, не попутно в PR участника.
Storage PR Димы #1: initial DB-test выявил 500 вместо 400 и неправильный envelope. Дима исправил порядок error handler и добавил ApiError assertions; повторная локальная проверка и CI с реальными миграциями/DB-тестами прошли, PR принят в main (`5d8ac861dcbccc77117d34fd599bdfe8ddd832cd`).
В PR #4 runs/GigaChat воспроизведён обход concurrency caps через bulk delete на head 1507e06: три незавершённые генерации при лимите 1. Отправлен request changes; merge требует проверки исправленного head и зелёного CI. Внешний live-путь ещё не пройден.
CI включает миграцию runtime-БД перед E2E/контейнером, миграции пустой отдельной БД дважды и реальные DB-тесты при наличии src/db/migrate.ts. До появления этого файла выводится явная граница foundation, без заявления DB-готовности.

## Фактически проверено в этой итерации

Локальный Docker Desktop запущен; compose PostgreSQL healthy, SELECT 1 успешен. После принятия PR #1 миграции dev-БД применены дважды, app.sessions существует. Корневой .env создан из шаблона и игнорируется Git; внешние ключи пользователь настраивает вручную.
Lint/typecheck и 10 тестов прошли, включая отсутствие утечки секретов и отказ запускать live-проверку без явной конфигурации.
services:check: PostgreSQL OK; Supabase/GigaChat BLOCKED. checkpoint:live: BLOCKED до HTTP-запросов. Это не live PASS.
Синтаксис compose.staging.yaml проверен через config --quiet с заведомо тестовыми значениями, публикация не выполнялась.

## Проверка подключённых сервисов 30.10.2026

После заполнения env и настройки CA: PostgreSQL SELECT 1 OK; Supabase public settings OK (email provider, signups, email confirmation включены); публичные env web/api совпадают. GigaChat OAuth и /v1/models успешны. Проверка баланса вернула положительную квоту для Ultra; точные суммы, токены и ответы не сохраняются.
Для первой live-проверки выбран и записан в локальный .env GIGACHAT_MODEL=GigaChat-3-Ultra. Модель присутствует в фактическом списке аккаунта; [официально поддерживает v1 и Freemium для физлиц](https://developers.sber.ru/docs/ru/gigachat/models/gigachat-3-ultra). Это не доказательство качества результата и принятия нашей JSON Schema: генерация в этой проверке не вызывалась.
Backend-провайдер дважды выполнил access-check с настоящими сервисами: OAuth запрос был один, второй access-check использовал кеш; генераций 0. Автообновление токена по expiry покрыто отдельным тестом. После применения принятых миграций настоящий API запущен и остановлен локально: readiness 200, me без Bearer 401. Локально lint/typecheck/build и 29 тестов прошли, 0 skips. CHECKPOINT_EMAIL/PASSWORD пока отсутствуют; checkpoint не запускался.
SMTP пользователем пока не настроен. До своего SMTP получать письма могут только участники организации Supabase, действует документированный лимит отправки. Реальные signup/confirmation/recovery пока не проверены.

## Отдельный аккаунт для checkpoint

Предпочтительный путь — зарегистрироваться через готовую форму приложения отдельным dev/test-адресом, подтвердить письмо и выйти. Пароль не должен совпадать с паролями кабинетов Supabase/Studio. Пока SMTP нет, адрес должен принадлежать участнику организации Supabase; GitHub membership этого не заменяет. Для полностью отдельного почтового адреса сначала настроить SMTP либо включить этот адрес в разрешённую команду Supabase с учётом её правил/тарифа.
Если UI ещё на review, для проверки исключительно API допустим отдельный пользователь через Authentication → Users → Add user в dev-проекте. Такой административно подтверждённый аккаунт нельзя засчитывать как проверку реальной регистрации/доставки письма. Приёмка signup/confirmation/recovery всё равно выполняется отдельно через UI.
Записать аккаунт только локально: CHECKPOINT_EMAIL и CHECKPOINT_PASSWORD; CHECKPOINT_ORIGIN=http://localhost:3000. CHECKPOINT_LIVE пока оставить 0. После готовности аккаунта/сервера lead сообщает о единственном вызове генерации, затем явно включает CHECKPOINT_LIVE=1 на время контрольного запуска. Ключи/пароль/Access token в чат не отправляются. Access token GigaChat пользователь не заполняет: backend получает, кеширует и обновляет его автоматически.
