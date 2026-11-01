# Этап 4 · публикация заблокирована площадкой, email — конфигурацией SMTP_HOST

## Последние результаты диагностики

Runtime остаётся **291507e20d4b8f5df38f055df870bf73cecb5f2e**, один app/poller и отдельная test DB. Нового изменения кода/контракта или image нет.

1. Владелец выполнил `/publish 8000`; @gg_domains_bot ответил: «Сервис публикации временно недоступен. Повторите команду позже. Если ошибка повторяется, сообщите организатору имя машины. Домен остаётся закреплён за вами». Это внешний блокер площадки. HTTPS не засчитан. Firewall/маршруты не менялись; другой порт/домен не подставлялся.
2. Владелец сообщил, что письмо регистрации не приходит. Настоящий checkpoint в test DB: **accounts1, verified0; challenge state=failed, attempts0, expiry ещё не наступил**. Адрес, код и hash не читались/не печатались. Поэтому это сбой отправки до SMTP acceptance, а не доказанная проблема спама или неверного кода.
3. Диагностика из фактического app-контейнера: **TLS stage→ENOTFOUND**. Дополнительно проверен именно нормализованный production RuntimeEnvironment.SMTP_HOST: trim не меняет значение, DNS hostname shape=false, lookup→ENOTFOUND, port465. Значение hostname не печаталось. Причина —неверный формат/значение SMTP_HOST в cloud test env; до TLS/AUTH/DATA текущая попытка не дошла.
4. AUTH-only диагностический код не содержит MAIL/RCPT/DATA и не отправляет письмо. Дополнительных тестовых писем0. Ранее проверенные локальные TLS/AUTH235/DATA250 не являются проверкой текущего cloud env.
5. Cloud health при проверке healthy: DB/HTTP/polling/workers/scheduler=true. Не отключать email verification и не извлекать код из DB ради продолжения checkpoint.

**Требуется действие владельца:** в `/home/ggadmin/.config/between-lines/test.env` исправить только SMTP_HOST на корректный hostname почтового сервера, без `https://`, `smtp://`, порта или email; можно перенести значение из рабочего локального.env. Сохранить0600, секреты в чат не передавать. Владелец запрошен сообщить «SMTP_HOST исправлен».

После подтверждения: проверить новый env в одноразовом контейнере без polling/письма; пересоздать только test app с существующим release.env291507e (обычный restart не перечитывает env); дождаться полного health и проверить TLS/AUTH без DATA. Только затем владелец нажимает resend в боте; повторная отправка —новое явное действие пользователя с доменным cooldown/intent, не автоматический retry неопределённой отправки. Failed challenge не превращать вручную в verified/sent.

Для организатора при повторении publish ошибки можно передать без секретов: «gg-ubuntu-01; atlas.gg.qqtech.ru; опубликованный VM HTTP порт8000, bind0.0.0.0; локальные GET / и /api/health/ready возвращали200; /publish8000 отвечает “Сервис публикации временно недоступен”». Агент сообщение организаторам не отправлял.

Настоящего сохранённого модельного результата/проверки истории после рестарта пока нет: блокер email не закрыт. Политика не заменена fixtures/bypass. Повторять генерацию/письма или менять инфраструктурный firewall для обхода блокеров нельзя.

## Этап 4 — предыдущая запись развёртывания

## Фактический deploy

Облако **gg-ubuntu-01**, SSH `ggadmin@109.194.123.17:2201`; ключ этого ПК работает. Docker29.1.3/Compose2.40.3 доступны ggadmin. VM фактически показывает1642MiB RAM и30GBdisk; это не доказательство достаточности для нагрузки. Маршруты/firewall организаторов не менялись.

Первоначально развёрнут **5292e5fd0f6d5eb58c35f1001d48b1061658fe63**. При проверке настоящего контейнера найден обязательный к исправлению дефект: `/`→500 при `/index.html`, `/auth/login` и health→200. Index существовал и читался uid1000; причина —directory root при `@fastify/static index:false`. Это основание необходимой смены SHA, не обновление по желанию.

**Текущий runtime SHA:291507e20d4b8f5df38f055df870bf73cecb5f2e**, ветка `fix/stage4-static-root`. Минимальный fix: явный GET `/`→sendFile(index.html), HEAD предоставляет Fastify. Контракт/модель/миграции не изменены. Новый regression GET/HEAD/query воспроизвёл500 до fix; после fix реальные HTTP/auth/CSRF/ownership+lifecycle4/4, lint/API types и13/13 Playwright PASS. Образ собран на ПК из git archive именно этого SHA; VM только загружает образ.

Image **between-stage4:291507e**, digest **sha256:e1fd1bed0ae1d87b7533fa25be81c4065d34406e8e2908e1a74cbe7dcd9f100a**. Архив проверен одинаковым SHA-256 на ПК/VM. Старый5292e5f image сохранён для rollback. PR/main/remote refs не менялись.

| Проверка | Результат на VM |
|---|---|
| Новый закрытый env | `~/.config/between-lines/test.env`,0600; старые env не перезаписаны; новые независимые DB/email/session/link secrets; model key из server-local0600endpoint.key |
| Test token/SMTP | Владелец заполнил непосредственно на VM; getMe подтвердил **@test_empather_bot**, webhook отсутствует. Основной token не использован. SMTP-письма/AUTH не повторялись; прежние235/250 не выданы за новый cloud email workflow |
| Cloud→Gemma | Direct Tailscale100.72.198.119→100.95.63.87, ping186ms (одна диагностическая точка, не p50/p95); `/v1/models` alias **Gemma-3-4B-IT-Q4_K_M**; `/props` context4096/template; настоящий LocalProductModel.describe из app-контейнера known=true |
| Model BASE_URL | **http://100.95.63.87:8080/v1**, соответствует существующему адаптеру; ключ не печатался, новых hosted inference нет |
| Изоляция DB | Новые project **between-test-5292**, DB **between_stage4_test_5292**, role between_test, volume **between_test_5292_pgdata**; до создания совпадающий volume отсутствовал; PostgreSQL17.6, внешнего port binding нет |
| Миграции | PASS,11миграций на новой test DB; реальный DATABASE_URL старого окружения не использовался |
| HTTP | После fix GET/HEAD `/`, `/index.html`, `/auth/login`, `/api/health/ready`→200; anonymous auth false, cookie Secure/HttpOnly |
| Полный health | DB/HTTP/polling/workers/scheduler=true. Первоначальная проверка сразу после startup была false до первого25s long-poll; повтор после завершения первого poll PASS, guard не отключён |
| Фактический VM port | **0.0.0.0:8000 → app:3000**, один app/poller; DB только внутри Docker network |
| RAM | Одно idle наблюдение: app69.46MiB, DB47.09MiB; не нагрузочный замер/не сумма всей ОС |
| Пользовательский результат/restart | На последнем снимке accounts/sessions/runs=0;11schema records сохранились после замены app. Это не проверка сохранённой истории/результата; ждать синтетический пользовательский run, затем перезапускать только test app |

Автопроверка отклонила автоматическую передачу локальных SMTP credentials на сервер. Передача не выполнялась; безопасный вариант выполнен владельцем —прямой ввод в private cloud test.env. Ни токены, ни email, ни коды/переписки/model outputs не печатались.

## Точные команды эксплуатации и публикации

Release-каталог на VM: `/home/ggadmin/between-test-5292`. Реальная конфигурация `compose.test.yaml`; её копия без секретов сохранена в [deploy/qqcloud-test.compose.yaml](../deploy/qqcloud-test.compose.yaml). Это test app+DB за HTTPS площадки; Caddy80/443 на VM не запускался. TRUSTED_PROXY_IPS пуст, произвольные forwarded headers не доверены.

Для последующих команд обязательно учитывать **release.env**, чтобы не откатиться на исходный APP_IMAGE5292e5f из private env. Секретный файл не переписывался:

```bash
cd /home/ggadmin/between-test-5292
dc() { docker compose --env-file /home/ggadmin/.config/between-lines/test.env --env-file ./release.env -f ./compose.test.yaml "$@"; }
dc ps
dc exec -T app node scripts/application-health.mjs
# Только после завершения пользовательского run и фиксации проверки сохранности:
# dc restart app
```

`release.env` содержит только override image=between-stage4:291507e; `source-sha.txt` фиксирует полный291507e. Источник частного model key не менялся.

**Владелец отправляет @gg_domains_bot точную команду:**

```text
/publish 8000
```

Затем подтверждает кнопкой. PDF организаторов прочитан; HTTPS выдаёт их инфраструктура, сертификат может занять3мин. Целевой origin **https://atlas.gg.qqtech.ru**. До успешного ответа publish и независимого HTTPS запроса сайт **не считается опубликованным**; последняя внешняя попытка дала URLError, подтверждённого HTTPS ещё нет. Команду боту агент не отправлял.

## Следующие обязательные действия

Владелец запрошен через UI: (1) подтвердить успешную `/publish 8000`; (2) пройти `/start` в @test_empather_bot, подтвердить email и разобрать **вымышленную** фразу «Ок, давай обсудим завтра», проверить очищенный preview и подтвердить отправку модели. Код/ответ/приватную web-link в чат не присылать. Диагностическое письмо повторно не отправляется; код регистрации возникает только по действию пользователя в боте.

После сообщения «тестовый анализ сохранён»: проверить succeeded run в отдельной test DB без вывода содержимого; дождаться pending=0; снять технический snapshot IDs/revisions/status без публикации значений; перезапустить только test app; проверить идентичность сохранённых записей и открытие той же истории через bot-issued web login. По необходимости отдельно проверить restart DB с сохранённым volume. До этого live model result/delivery/email workflow/HTTPS/history acceptance не объявлять успешными. Полного27-feature live прогона/нагрузки/backup/restore нет.

## Этап 4 — предыдущая запись подготовки

Целевой deploy SHA остаётся **5292e5fd0f6d5eb58c35f1001d48b1061658fe63**. Последующие commits этой ветки —только отчёт, не новая версия runtime. Повторных писем не отправлялось; SMTP AUTH235/acceptance250 из предыдущего шага остаются действующими результатами без новой проверки.

## Подтверждённые параметры и текущее препятствие

- Cloud: `gg-ubuntu-01`, SSH `ggadmin@109.194.123.17:2201`; домен `atlas.gg.qqtech.ru`. Целевой WEB_ORIGIN=`https://atlas.gg.qqtech.ru`, HTTPS считается готовым только после успешной публикации и внешней проверки.
- Домашняя Gemma: `http://100.95.63.87:8080`, разрешённый cloud Tailnet IP=`100.72.198.119`. По существующему адаптеру правильный **LOCAL_LLM_BASE_URL=http://100.95.63.87:8080/v1**; корень без/v1 приведёт к неверному `/chat/completions`. Предполагаемый alias из model-lock=`Gemma-3-4B-IT-Q4_K_M`; фактический alias должен быть подтверждён `/v1/models` с облака, не принят на веру.
- Владелец сообщил о сохранённом на облаке приватном model key с0600. Его путь/режим/значение пока не проверены: SSH заблокирован. Инструкции называют `endpoint.key` или приватные cloud env/settings; после входа искать по существующим конфигурациям, не печатать содержимое и не создавать новый endpoint key.
- На этом ПК найдены только `~/.ssh/id_ed25519` и соответствующий `.pub`; `id_rsa` отсутствует, ssh-agent недоступен. Public fingerprint **SHA256:GTZQEfuxO+PKWnefbypeG8lOPeDVG8wRi71oOPpFasw**, ED25519/256. Новый ключ не создавался. Повторный BatchMode/IdentitiesOnly вход этим ключом: **Permission denied (publickey,password)**. Устаревшие алгоритмы не включались, парольный вход не отключался.

### Действие владельца для восстановления SSH

В PowerShell показать только публичный ключ:

```powershell
Get-Content -LiteralPath "$env:USERPROFILE\.ssh\id_ed25519.pub"
ssh -p 2201 -o PubkeyAuthentication=no -o PreferredAuthentications=password ggadmin@109.194.123.17
```

В парольной SSH-сессии:

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
cat >> ~/.ssh/authorized_keys
# Вставить целую строку публичного ключа, Enter, затем Ctrl+D.
chmod 600 ~/.ssh/authorized_keys
```

Существующие ключи сохраняются, приватный ключ/пароль не пересылаются. После сообщения владельца «ключ добавлен» повторить вход с `-i "$env:USERPROFILE/.ssh/id_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes`. Пока такого подтверждения/успешного входа нет, cloud env и сервисы не изменялись.

## Прочитанная инструкция организаторов

PDF **C:/Users/anton/Downloads/Telegram Desktop/Инструкция для участников.pdf** найден и прочитан через pypdf. Он подтверждает: приложение слушает HTTP на0.0.0.0, Docker публикует порт на VM; владелец отправляет **`/publish ПОРТ`** боту **@gg_domains_bot** и подтверждает кнопкой. HTTPS выдаёт инфраструктура, первый сертификат может занять до3мин; открывать надо возвращённую ссылку. Общий публичный IP не означает адрес отдельного сайта. При502 сначала curl на VM, затем обращение организаторам; маршруты/firewall инфраструктуры не менять.

**Фактический порт ещё не определён**, поскольку VM недоступна. `/publish 8000` в PDF —пример, не готовая команда для текущего экземпляра. После проверки свободного порта, bind0.0.0.0 и curl на VM записать точную `/publish <проверенный номер>`. Не отправлять команду заранее и не объявлять HTTPS готовым по одному значению WEB_ORIGIN.

Для этого пути использовать test app+test db и HTTPS-прокси организаторов; отдельный Caddy80/443 из общего runbook не требуется автоматически. Это deployment-конфигурация для существующего5292e5f, не смена архитектуры/контракта. DB наружу не публикуется. TRUSTED_PROXY_IPS не расширять до true/wildcard: по умолчанию оставить пустым, пока точный адрес доверенного proxy не установлен; production cookies уже Secure/HttpOnly по environment.

После восстановления SSH: read-only inventory Docker/процессов/Tailscale/портов/env→найти0600model key→проверить `/v1/models`, `/props` и tokenizer/template→создать изолированный test project/DB/volume/env без перезаписи старых env→попросить владельца ввести **отдельный test bot token прямо в файл** при его отсутствии→миграции новой test DB→один poller→HTTP→фактическая `/publish`→HTTPS→синтетический сохранённый результат и рестарт только test app. Независимые web/email secrets генерировать непосредственно в закрытый test env, не выводить. Основной bot token не использовать; реальные данные не читать/изменять. Live-проверки этого списка пока не выполнены.

## Предыдущая попытка — сохранённый журнал

## Выбранная версия и итог

Для развёртывания выбран проверенный **5292e5fd0f6d5eb58c35f1001d48b1061658fe63** (`test/integration-stage3`, runtime/test измененияf1b6611, контракт2.2.1). Подготовленный локальный образ подтверждён: **sha256:14a127b0b67fbd457f28077b34bb0807e16a0dbfe07fd119d5f5d54b0d8d14de**. Прочитаны runbook и предыдущие результаты; повтор полной локальной приёмки не выполнялся.

**Deploy не выполнен: SSH отвергает доступный ключ; параметры отдельного test bot и домашнего endpoint отсутствуют.** Не использовать прежнее локальное тестирование как доказательство работы облачного экземпляра. На сервере не запускались команды/миграции/контейнеры; реальные данные, firewall, маршруты, main и PR не менялись.

| Проверка | Фактический результат |
|---|---|
| SSH `ggadmin@109.194.123.17:2201`, BatchMode + IdentitiesOnly + StrictHostKeyChecking | **FAIL: Permission denied (publickey,password)**. Пробован существующий `C:\Users\anton\.ssh\id_ed25519`; `id_rsa` на этом ПК отсутствует. Пароль/приватный ключ не выводились, устаревшие алгоритмы не включались. |
| Корневой .env / найденный deploy/auth/.env | Проверено только наличие нужных полей, значения не печатались. В обоих нет bot token/test bot token, test DB URL, LOCAL_LLM_* и текущих web/code secrets/origin. SMTP заполнен в корневом .env. Реальный DATABASE_URL не использован для соединения/миграций. |
| SMTP TLS465 | **PASS**, проверка сертификата включена, AUTH PLAIN доступен; TLS не отключался. |
| SMTP AUTH | **PASS,235** с существующими SMTP_USER/SMTP_PASSWORD. |
| Одна разрешённая тестовая отправка | **PASS,250 после DATA**. Получатель строго SMTP_USER; тема «Между строк — проверка почты», текст «Тестовая отправка работает». Ровно одна DATA submission, повторной отправки нет; регистрационных кодов/переписок нет. Доставка в ящик не проверена. |
| Gemma/cloud→Windows | **BLOCKED**: нет LOCAL_LLM_BASE_URL/MODEL/API_KEY и SSH для проверки удалённого env/закрытой сети. Запросов генерации0; источник модели/адрес не угадывался. |
| HTTP/HTTPS опубликованного5292e5f | **НЕ ПРОВЕРЕНО**: экземпляр не развёрнут, фактический WEB_ORIGIN не задан. Localhost не выдан за staging. |
| Сохранение данных после облачного рестарта | **НЕ ПРОВЕРЕНО**: отдельная test DB/экземпляр на сервере не созданы. Старые локальные DB-тесты не засчитаны как этот gate. |

SMTP проверен отдельным локальным диагностическим скриптом с чтением существующего env: 465/TLS→EHLO→AUTH→один MAIL/RCPT/DATA→QUIT. Он не меняет почтовый адаптер проекта, не печатает адреса/учётные данные/ответы сервера с приватными подробностями и не повторяет отправку при неопределённом исходе. Эта проверка не доказывает SMTP-egress из QQCloud или app email challenge workflow.

## Конкретные действия для продолжения

1. Добавить **публичный** ключ этого ПК `C:\Users\anton\.ssh\id_ed25519.pub` в `~ggadmin/.ssh/authorized_keys` через доступную владельцу консоль/сессию либо указать путь к другому уже доступному локальному ключу. RSA-ключ домашнего GPU-ПК не доступен на этом ПК; приватный ключ в чат не передавать. После исправления повторить только SSH-проверку:
   `ssh -p 2201 -i "$env:USERPROFILE/.ssh/id_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes ggadmin@109.194.123.17 hostname`
2. Подготовить отдельный закрытый test env по .env.example: TELEGRAM_BOT_TOKEN именно отдельного test bot, LOCAL_LLM_BASE_URL/MODEL/API_KEY из фактического домашнего endpoint и реальный WEB_ORIGIN. Токены/пароли только env/хостинг. После получения SSH создать отдельный Compose project/test volume/test DB и свежие независимые code/session/link secrets по runbook; не применять старый DATABASE_URL к реальным данным. Создавать отдельную test DB разрешено, но сейчас выполнение на сервере блокирует SSH.
3. После подключения проверить существующие Docker/disk/Tailscale/порты без изменения firewall организаторов, загрузить проверенный образ (не собирать на2ГБ VM), выполнить миграции только новой test DB и запустить один poller. Затем проверить Gemma/HTTP, записать синтетическую ситуацию в отдельную test DB, перезапустить только test app и подтвердить тот же сохранённый результат.

**Команда `/publish`: не определена и не выполнялась.** В доступных runbook/deploy/hackathon/team инструкциях её синтаксиса нет; неизвестны также сервис/бот организаторов и фактический домен. Нужна точная инструкция или вывод help организаторского publish-бота без секретов. Угадывать `/publish <...>` нельзя. Для обычного SSH/Docker/Caddy пути runbook такая команда не требуется; необходимость зависит от площадки и ещё не подтверждена.

Работа остановлена после доступных проверок и одной разрешённой отправки. Облачный deploy/live acceptance не объявляются успешными. Существующие .env и чужие изменения сохранены; новых PR/merge/push нет.

## Этап 3 — сохранённая запись

## Результат этапа 3

Проверенная основа этапа2: **60ad5b8f7f661c15cb9cb34c5d780b8700528f91**, поверх candidate b9d7557/контракт2.2.1. Новая локальная ветка **test/integration-stage3**, worktree `.tools/stack-a1-nov01`. Добавленные acceptance-регрессии закоммичены: **f1b66116c303423e9811d962d59e68c9169779a7**; итоговую запись фиксирует следующий docs-only commit. Production-код, контракт, guards и миграции не менялись. Ничего не отправлялось на remote; merge/deploy/live не выполнялись.

## Фактические проверки этапа 3

Отдельный одноразовый контейнер PostgreSQL17.6-bookworm, loopback57351, разные `stage3_runtime`/`stage3_test`. Тестовая БД чистая перед обязательным набором; миграции выполняет настоящий harness. Node24.22.1/Playwright1.56.1; локальный Chrome157 через явный `PLAYWRIGHT_CHANNEL=chrome`, временные browser contexts. Корневой .env не читался и не копировался. Реальные domain/repositories/Fastify/PostgreSQL, закоммиченные явные test-only mail/model/Telegram adapters; незакоммиченных заглушек нет.

| Проверка | Фактический результат |
|---|---|
| `npm test` на60ad5b8 | **43 contracts/root +90 domain/HTTP/bot/lifecycle PASS,0fail/0skip**; включает stage2 idempotency regression |
| `node scripts/check-web-runtime.mjs` + `npm run e2e` | **Все13 PASS**, без фильтрации/skip; guards/CSRF/ownership не отключались |
| Новые `domain-stage3-acceptance.test.ts` наf1b6611 | **3PASS,0fail/0skip**: deletion session/account во время генерации;3уровня роли с early feedback |
| `npm run lint` и API typecheck после добавления теста | PASS; остальные typechecks из этапа2 не повторялись без изменения соответствующего кода |
| `docker build -t between-stage3-check:local .` | PASS из чистого закоммиченного дереваf1b6611; внутри настоящий production build contracts→api/bot/web и browser runtime guard, затем prune dev |
| Production image imports с `--network none` | PASS: createDomain/createHttpAdapter/createTelegramTransport доступны, процесс завершается без старта серверов; .env/test browser adapter/Supabase package отсутствуют; AUTH_BYPASS отвергается |
| Runtime export под browser condition в image | PASS: ERR_PACKAGE_PATH_NOT_EXPORTED |
| `node scripts/check-compose.mjs` | PASS: только proxy80/443, DB/model не публикуются, exact proxy trust, актуальный env schema; Compose не запускался |

Образ: **sha256:14a127b0b67fbd457f28077b34bb0807e16a0dbfe07fd119d5f5d54b0d8d14de**, USER=node. Повторная сборка Docker необходима для поставки текущего закоммиченного дерева; отдельный host build из этапа2 не дублировался. После добавления3API-тестов повторены только они и их lint/typecheck; полный набор/13browser заново не запускались, потому что runtime/browser код не изменился. Всего проверено90+3 domain/transport tests, но это два отдельных запуска, не один93-test run.

### Приоритетные свойства

- **Ownership двух пользователей/auth/CSRF:** domain-issued contexts; поддельный context отвергается; чужие session/run IDs недоступны; реальные HTTP cookie exchange, one-time/replay/races/logout/revoke/expiry и missing Origin/CSRF. Browser проверяет чужие прямые URL/API и logout/reload.
- **Показанный snapshot:** DB-тест navigation отвергает подтверждение не показанной/устаревшей версии, exact hash/revision и изменённые зависимости; browser проверяет masking, edit→revision2, запрет send до сохранения, подтверждение и test-model run.
- **Идемпотентность/restart:** same/different intention races, scope user+operation, потеря ответа/рестарт, удалённый ресурс не воскресает; persistent dialogue/assessment/run/delivery и idempotent close/lease проверены настоящей БД. Browser refresh восстанавливает историю/черновик/vote.
- **Удаление при генерации:** существующий DB-тест deleteData и новые session/account cases удерживают управляемую генерацию, удаляют данные, затем возвращают поздний output. Проверены отсутствие удалённого run, completion event и delivery, отсутствие утечки другому пользователю; следующий пользователь получает собственный результат. Удаление не освобождает физический permit до окончания незавершённого вызова.

### Остальные функции по существующей приёмке

Ниже перечислены проверенные действия/состояния, а не наличие кнопок. `domain` означает настоящий storage/FSM с явно тестовым модельным результатом, `bot` —тест транспорта без Telegram сети. Это не доказательство качества модели или полного web UX.

| Объём раздела7 | Выполненное поведенческое доказательство | Граница |
|---|---|---|
| Аккаунт/онбординг | domain/web-product/bot: consent/email gate, challenge recovery/resend, verified state; cookie exchange/logout/revoke | Реальные email/Telegram не отправлялись |
| Примеры/контексты | domain-product:8examples; bot:выбор примера→гипотеза→preview, history/example context filtering | Не все8 примеров прогнаны настоящей LLM |
| Понять/своя гипотеза/основания | persisted analysis run, exact evidence quote/field validation, own guess или unsure; browser анализ→result | Качество трактовок/comparison тестовым output не подтверждается |
| Сказать прямо/до отправки | domain-learning: оба draft-only режима создают успешные валидированные runs без вымышленного входящего сообщения; bot проходит сценарий | Сохранение смысла/отказа реальной моделью требует живой оценки |
| Разбор фраз/цели ответа | domain-learning: reply_feedback/reply_examples через confirmed snapshots; bot проверяет tone words/details/examples и own attempt | Реальная корректность формулировок и интерактивная web-подсветка не покрыты13browser целиком |
| Скрытие данных/ветка | mask email/phone и redaction provenance; shown snapshot; stale/oversize guards; bot edit/reorder/restart по stable turn IDs | Модельное качество и все web-редакторы отдельно не приняты |
| Упражнение/навыки | exercise→attempt→feedback, две durable skill attempts с rubric; bot проходит попытку | Реальный полезный feedback не доказан |
| Ролевая игра | domain-learning:3ответа/четвёртый запрещён; новые tests:calm/hurt/irritated и early finish после1ответа, before turn1 запрещён | Модель тестовая;3уровня поведения настоящей LLM не оценивались |
| Практика дня/карточки/стрики | concurrent completion→один completion; localDate, count=1, best/current streak; card feedback persisted | Нет полного web UI прогона карточек/практики |
| Напоминания | domain-learning: opt-in, DST gap/overlap, quiet hours, restart, local-date dedup, unsubscribe; bot delivery/settings | Реальная Telegram доставка/таймеры облака не проверены |
| До/после | canonical partial answers→restart→atomic submit, чужая форма/неверный порядок запрещены, rubric2;7дней/followup через явные test clocks; browser menu/reload/confirmed discard | Реальный недельный период и эффект обучения не доказаны |
| История/прогресс | domain/storage и bot:pagination/search/context filter/edit revision; counters unique; browser same-account history/reload и owner isolation | Не все фильтры/продолжения web проверены браузером |
| Полезность/аналитика | owned myRating read after restart; browser useful→reload→not_useful→reload; domain aggregates один upsert vote, completion event только success | Нет внешней аналитики/психологических выводов |
| Сложные ситуации | bot support branch вместо normal send; domain supportRegion explicit/revision, unknown/unavailable→contacts=[]; browser preference сохранена/сброшена | Актуальность телефонов/распознавание реальной моделью здесь не переаттестованы |
| Удаление | отдельные session/data/account actions + поздний ответ; tombstone/revision/ownership; bot confirmations | Реальный phone/cloud сценарий не запускался |

Первый запуск нового roleplay-теста не прошёл: тест пропустил обязательный предварительный анализ и ожидал неверный код при finish до первого ответа. Guard корректно отверг запрос. Исправлены только предусловия/assertion теста; затем3/3PASS, runtime-ошибкой это не объявляется. Старый единичный fail88-test набора в обязательном прогоне90 не воспроизведён; причина по-прежнему не установлена.

## Пропуски, live-блокеры и остановка

Полный audit PR/исходников, повтор legacy suite целиком, новый remote CI, live SMTP/Telegram/домашняя Gemma, QQCloud/HTTPS, network reconnect/offline/reboot, RAM/VRAM/TTFT/p50/p95, backup/restore и оценка качества полного раздела7 **не выполнялись**. Fixtures не засчитаны как генерация реальной LLM. Новых отправок писем/модельных запросов к внешним сервисам0.

Для live нужны проверенные отдельные test bot/DB, серверные secrets/WEB_ORIGIN в env, app SMTP verification flow, доступ QQCloud→домашний private endpoint (ПК включён, ACL/firewall/direct-or-relay), реальный HTTPS/cookie origin/host process/disk и второй пользователь/телефон. Наличие этих доступов в этом этапе не проверялось.3moderate runtime advisories из npm prune сохраняются; auto-fix/смена стека не делались. Полная продуктовая приёмка не закрыта, хотя указанные локальные gates прошли.

Этап3 завершён. Следующий шаг —отдельно разрешённая подготовка/проверка live окружения и закрытие отмеченных UI/качественных пробелов. PR не слиты/не закрыты, деплоя/публикации нет; .env/чужие изменения сохранены. Одноразовая DB после проверок останавливается.

## Этап 2 — сохранённая запись

## Результат этапа 2

Основа неизменна: **b9d75571252286c85be280e44c62f3c60712c3de**. Отдельная локальная ветка **fix/integration-stage2**, worktree `.tools/stack-a1-nov01`. Изменения этапа: **621162e1f14b02629740379dd67292d34be55b7f**; следующий docs-only commit фиксирует эту запись. Ветка не отправлялась на GitHub; PR, main и remote candidate не изменены. Контракт остаётся2.2.1, production-код/DTO/миграции/зависимости не менялись.

В этапе1 не было установленного дефекта сборки b9d7557 или отсутствующего полезного runtime-патча участников. Поэтому вместо неподтверждённого изменения рабочего кода закрыты конкретные пробелы проверки совместимости:

- Полезные acceptance-кейсы старого#11 перенесены в `apps/api/test/domain-stage2-compat.test.ts` на настоящую текущую фасаду и PostgreSQL: конкурентный одинаковый intent→одна запись; тот же ключ другого пользователя независим; другой порядок ключей JSON не меняет intent; потеря ответа/рестарт возвращает ту же сессию; scope разных операций независим; удалённая сессия не воскресает; конкурентный разный payload→один успех/один IDEMPOTENCY_CONFLICT. Генерация для этих проверок не вызывается.
- Исправлен устаревший SHA выбранной основы и ancestry-команда в handoff: candidate=b9d7557,6755408 —его integration-fixes ancestor.
- Адресно проверены уже включённые backend/bot/web HTTP bindings, menu/reset/vote, рестарт сценариев и lifecycle. Ошибок, требующих правки общей сигнатуры или runtime-реализации, не воспроизведено. Старые Bearer/BotDomain/grammY patches не переносились повторно.

## Фактические проверки этапа 2

Node24.22.1; отдельный одноразовый PostgreSQL17.6, loopback57350, разные `stage2_runtime`/`stage2_test`; миграции тестовой БД применяет существующий harness. Корневой .env не читался и не копировался. Mail/model/Telegram adapters явно тестовые, HTTP/domain/DB настоящие.

| Проверка | Результат |
|---|---|
| `npm run build` | PASS: contracts→api/bot/web, production browser guard сохранён |
| `npm run typecheck` | PASS: contracts/api/bot/web и типы тестов |
| `npm run lint` | PASS, max-warnings0 |
| Адресные6 test files: domain-stage2-compat, domain-review-decisions, web-lifecycle, web-product; bot.test, restart-recovery | **63pass,0fail,0skip**, через node/tsx test runner, raw ошибки/секреты не печатались |
| Дополнительные3 последовательных повтора domain-review-decisions + web-lifecycle | Каждый **4pass,0fail,0skip** |

Полный Playwright, полный npm test, legacy suite целиком, live SMTP/Telegram/model, Docker build/deploy и новая проверка remote CI **не выполнялись** в этапе2. Старый зелёный CI b9d7557 относится к основе; не выдавать его за CI нового локального commit. Репозиторий/история PR повторно не аудировались. Корневые пользовательские файлы/.env сохранены.

## Оставшиеся проблемы и следующий шаг

1. Прежний единичный fail88-test набора не воспроизведён целевыми проверками; его причина **не установлена**, проблема не объявляется исправленной. При следующем полном разрешённом прогоне сохранить безопасное имя/место failure и устранить конкретную причину.
2. Проверены текущие bot-сценарии и recovery, но это не полный equivalence-аудит#17/#19; основания автоматически закрывать старые PR не добавлены. Старое требование#11 о replay после PATCH отдельно не переносилось в runtime: текущая фасада возвращает сохранённый receipt; изменение этой семантики потребовало бы отдельного решения по контракту.
3. Live gates и dependency advisories из этапа1 остаются отдельными задачами; доступы и .env здесь не проверялись. Нельзя объявлять готовым полный продукт по63 тестовым сценариям.

Следующий этап —после отдельного разрешения проверить полный browser/shared-account gate на ветке с621162e, затем подготовить live checkpoint с отдельными test bot/DB и доступами. Никаких merge/close PR, отправки сообщений, публикации или развёртывания в этапе2 нет. Этап2 завершён.

## Этап 1 — сохранённый снимок проверки состава

## Выбранная основа

`sharbl4/empathy-coach`, remote `test/stack-a1-nov01` → **b9d75571252286c85be280e44c62f3c60712c3de**. SHA актуален после fetch/ls-remote. `PRODUCT_CONTRACT_VERSION='2.2.1'` проверен в дереве этого commit; контрактный commit —9cd742fe46527710e1932035924358a85ea3df4c. Код интеграционных исправлений —6755408; b9d7557 добавляет handoff через merge2fcc66e.

Существующий [CI именно b9d7557](https://github.com/sharbl4/empathy-coach/actions/runs/41233808218) завершён SUCCESS: contracts-and-root, web-release, domain-bot-web-integration. В этом этапе сборка/тесты не запускались. Это проверка состава и прежнего CI, не новый аудит или live-приёмка.

Рабочая папка остаётся на `feat/web-telegram-integration`/2fcc66e, а не candidate. До работы: изменён `hackathon-prompts.md`, untracked `.vscode/`, `team-tasks-web-telegram.md`. Они и `.env` не менялись. Единственное добавление этапа —этот документ. `main`/a588e5561a7b31f37a65a087863249258c919c30 является предком candidate (30 commits впереди,0 позади); main не изменялся.

## Открытые PR и состав candidate

Все перечисленные PR остаются OPEN/DRAFT. Их состояние, база и содержимое не менялись. Головы#22/#23 не продвинулись относительно предыдущего review.

| PR | Актуальная голова / база | Проверенное отношение к candidate | Решение по составу |
|---|---|---|---|
| [#23](https://github.com/sharbl4/empathy-coach/pull/23) | fabed23 / feat/web-telegram-integration | HEAD —предок candidate, отсутствующих commits0, diff `candidate...head` пуст | Backend Димы полностью включён: a2bb682, порт2.2 и последующие исправления. Candidate дополнительно содержит2.2.1 integration fixes. |
| [#22](https://github.com/sharbl4/empathy-coach/pull/22) | f12d309 / feat/web-telegram-integration | HEAD —предок candidate, отсутствующих commits0, diff `candidate...head` пуст | Web+bot Дани полностью включены, включая03408e2 и2.2 persistence/support/shown-preview. Заголовок PR про2.1 устарел. |
| [#21](https://github.com/sharbl4/empathy-coach/pull/21) | d97ddf1 / feat/web-telegram-integration | SHA не предок, но `git cherry candidate head`: оба2f894e6/d97ddf1 имеют `-` (эквивалентные патчи уже есть) | Заменён#22; повторно переносить bot/web commits не нужно. |
| [#20](https://github.com/sharbl4/empathy-coach/pull/20) | f9fc301 / feat/telegram-integration | SHA не предок, но patch-equivalent (`git cherry`: `-`); миграции003–006 побайтово совпадают с candidate по diff | Заменён#23; старую/domain фасаду поверх новой не применять. |
| [#19](https://github.com/sharbl4/empathy-coach/pull/19) | 3b7ef64 / feat/telegram-integration | Не предок, patch-id не совпадает; diff показывает замену старого main/fake-domain на index/runtime/product facade и новые recovery-тесты | Реализация заменена#21→#22. Имена тестов подтверждают сохранённые основные группы сценариев, но полного equivalence всех старых сценариев этот этап не доказывает. |
| [#18](https://github.com/sharbl4/empathy-coach/pull/18) | ed72784 / main | HEAD —предок candidate, отсутствующих commits0 | Foundation включён. Telegram-only/архив web заменены утверждённым web+Telegram решением; не восстанавливать старые инструкции. |
| [#17](https://github.com/sharbl4/empathy-coach/pull/17) | 6568f35 / main | Не предок, patch-id не совпадает; прежние grammY/BotDomain/main/memory-domain заменены общим product transport | Заменён цепочкой#19→#21→#22. Не сливать старую архитектуру. Закрытие требует отдельно подтвердить сценарную сохранность; сейчас не закрыт. |
| [#11](https://github.com/sharbl4/empathy-coach/pull/11) | 649d219 / main | Не предок, patch-id не совпадает; legacy contracts0.2/Bearer/workspace manifests | Старый способ доставки заменён v2 session auth/общей идемпотентностью. Полезное требование user+operation+key сохранено в текущих протоколе/реализации; старые manifest/auth/DTO патчи не переносить. Все частные старые acceptance-кейсы отдельно здесь не прогонялись. |

## Что включено и что ещё отсутствует

Включены настоящие facade/HTTP/browser adapter Димы и web/bot Дани, server-only runtime export, persistent dialogue/email recovery/support region; исправления6755408: shown preview binding, autosave, чтение myRating, menu/resume/подтверждённый reset теста, Telegram edit/reorder и связанные регрессии. Миграции сохранены. Основание —история и ограниченный diff, а не FEATURES-27.

**Новых полезных commits актуальных#22/#23 за пределами candidate нет.** Отдельного полезного отсутствующего патча из старых PR ограниченная проверка не выявила. Это не гарантия функционального равенства#17/#19: их SHA/patch-id отличаются, сопоставлены группы сценариев/структура, а не весь исходник. Полезные regression-сценарии старых PR надо сохранить при отдельном решении об их закрытии; возвращать устаревшие transports/auth/contracts не требуется.

## Приоритеты и конкретные блокеры

1. **P0 —основа интеграции:** запускать/проверять именно candidate целиком. Root `feat/web-telegram-integration` содержит контракт/docs, но не объединённые модули. Индивидуальные#22/#23 имеют красный integration CI, у#23 также web-release; это не красный CI candidate. Отсутствующий модуль в частичной ветке нельзя лечить заглушкой или отключением job. Выявленного блокера сборки самого b9d7557 нет; новый build в этапе1 не выполнялся.
2. **P1 —незавершённое review:** один прежний88-test прогон имел неидентифицированный fail; последующие прогоны и CI успешны. Причина не установлена, считать остаточным риском. При воспроизведении использовать добавленную безопасную диагностику, не объявлять проблему исправленной без причины.
3. **P1 —live-интеграция не принята:** реальный общий путь требует отдельного test bot/DB, корректных server secrets/WEB_ORIGIN, app SMTP workflow, доступного QQCloud→домашняя модель private endpoint/ACL и фактического HTTPS окружения. Наличие этих доступов в этапе1 не проверялось, `.env` не читался. Старые сообщения о локальной Gemma/SMTP не доказывают путь между сервисами. Это блокеры live-приёмки, не установленная причина падения сборки.
4. **P2 —перед закрытием заменённых PR:** подтвердить сохранность полезных сценариев#17/#19 и отдельных legacy-idempotency acceptance-кейсов#11; затем решить судьбу старых PR отдельно. Не переносить их целиком. Уточнить устаревшие версии в заголовке#22 и handoff (там6755408 назван candidate вместо текущего b9d7557) на следующем разрешённом этапе. Сейчас PR/docs handoff не менялись.
5. **P2 —отдельный dependency review:** прошлый Docker build сообщил3moderate runtime advisories; актуальный аудит здесь не запускался, auto-fix/смена зависимостей не выполнялись.

## Следующий шаг

После отдельного разрешения на этап2 —использовать изолированную worktree от **b9d7557** как единую основу, согласовать принятие уже включённых integration fixes участниками и выполнить адресную проверку спорных сценариев/одиночного flaky fail. Новых commits участников для сборки сейчас ждать не требуется. Затем отдельно согласовать live checkpoint; deploy, merge/close PR и изменение main не входят в этот этап.
