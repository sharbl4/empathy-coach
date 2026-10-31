# Интеграция · этап 3 · 01.11.2026

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
