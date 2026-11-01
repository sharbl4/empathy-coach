# Финальная передача Empather · shertwg^3

Актуальная объединённая ветка: `feat/final-defense`. Полезные изменения Димы b71af10 и Дани 5bc5f5f/f7690b2 включены; старые статусы ниже исторические. Точный SHA, проверки, runtime и оставшиеся блокеры: [integration-progress](integration-progress.md). Защита: [demo-final](demo-final.md). Контракт 2.2.1, архитектура и миграции не менялись; продолжение использует существующий persistent dialogue.

# Единый старт A1 2.2.1 · 01.11.2026

Этот раздел заменяет прежний статус ниже. Контракт опубликован: **9cd742fe46527710e1932035924358a85ea3df4c**, ветка `feat/web-telegram-integration`. Минимальная семантика: [contract-v2.2.1.md](contract-v2.2.1.md), точные сигнатуры: [facade-v2.2.md](facade-v2.2.md).

**Общий исполняемый candidate: b9d75571252286c85be280e44c62f3c60712c3de, `test/stack-a1-nov01`.** Integration fixes находятся в6755408; b9d7557 также включает опубликованный handoff. Он содержит опубликованные backend **fabed230db9a139e8ff46a5a788ab852fa87eea2** (включает a2bb682 и перенос2.2), interfaces **f12d309e1d5ebe41f4344a3c7fcf5490c7b28556**, новый контракт и минимальные integration fixes. Это отдельная ветка для совместной проверки; GitHub PR22/23 не слиты, ветки участников не переписаны. Для запуска брать candidate целиком, не старый a2bb682 и не только contracts-ветку. Детали: [review-stack-2026-11-01.md](review-stack-2026-11-01.md); текущий этап —[integration-progress.md](integration-progress.md).

```sh
git fetch origin
git switch -c integration-review-nov01 origin/test/stack-a1-nov01
git merge-base --is-ancestor b9d75571252286c85be280e44c62f3c60712c3de HEAD
npm ci
```

Не выполнять switch поверх своей незакоммиченной работы: сначала сохранить её или создать отдельную worktree. Не cherry-pick повторно a2bb682/f12d309: их история уже присутствует. .env и IDE не перезаписывать.

## Задания участникам

**Дима:** совместить актуальную собственную ветку с candidate через merge без force/reset. Проверить изменения `dialogue.ts` (menu сохраняет assessment; reset требует явное confirmation), `runs.ts`/`sessions.ts` (myRating из votes в каждой owned projection), `learning.ts` (полный enum для внутреннего события). Новых таблиц/миграций не требуется. Сохранить atomic completion transaction и UNIQUE event; client recordStage отвергает run_completed. Принять DB/HTTP/lifecycle регрессии. Если появились более свежие незапушенные изменения — сначала сохранить и разрешить конфликты, не подменять их старым candidate.

**Даня:** совместить свою ветку с candidate; принять preview shown binding, autosave после загрузки и отмену debounce при submit, чтение myRating, сохранение теста при /menu, resume с правильным step, отдельный подтверждённый reset, редактирование/перестановку turn по стабильному ID. Новых собственных DTO не создавать. Если тест незавершён, новый мутирующий сценарий не должен молча уничтожать его: предложить продолжить/явно сбросить. Изучить две поправки browser-тестов (настоящая новая вкладка вместо hash-only goto; дождаться завершения logout); assertions сохранены. Все13 сценариев обязательны, включая добавленные assertions оценки/reload и menu/discard.

## Фактические проверки candidate

Node24.22.1; PostgreSQL17.6 в отдельном Docker-контейнере, разные runtime/test DB, реальные committed facade/HTTP/browser adapter. npm build/typecheck/lint, migrations,43 contracts/root и88 domain/HTTP/bot checks,13 Playwright — успешно, пропусков0. Сохранённый legacy-набор56 checks также успешно (частично пересекается с основным, не складывать счётчики). Lifecycle использует настоящие PG/domain/workers/HTTP и явный network-free Telegram transport; проверены один домен, double close, закрытие порта/healthfile/lease. Docker production image собран, exports импортированы с `--network none` без запуска сервисов. Browser локально: установленный Chrome157 через PLAYWRIGHT_CHANNEL=chrome; CI по-прежнему закреплённый Playwright1.56.1 Chromium.

Был один общий прогон88 с1fail, имя скрыл прежний reporter. Два последовательных диагностических повтора88/88 успешны; причина единичного сбоя не доказана, не объявлять её исправленной. Теперь runner выводит только статические имена упавших тестов, без raw ошибок/SQL/auth URL. FEATURES-27 — inventory, не E2E evidence. GitHub CI candidate: [run41233504509](https://github.com/sharbl4/empathy-coach/actions/runs/41233504509); итог проверяется отдельно, локальные проверки не подменяют его.

## Следующий live checkpoint и доступы

Сначала зафиксировать remote CI и peer acceptance исправлений; затем отдельный test bot/DB, серверные session/link/email secrets и WEB_ORIGIN в env, работающий SMTP, частный endpoint включённого домашнего GPU-ПК (включая разрешённый cloud node/ACL/firewall), SSH/Docker/persistent disk QQCloud и фактический DNS/HTTPS. Сам факт локального ответа Gemma ранее сообщил владелец; cloud→model здесь не проверялся. Секреты только env/хостинг, не Git/чат. Не переиспользовать production token для параллельного poller.

На чужом телефоне: Telegram→email consent/verification→ситуация→очищенный preview→модель→сохранённый результат→одноразовая ссылка→web POST login→та же история/reload/vote→проверка второго пользователя. Затем restart/history и offline-PC error при доступной истории. Реальных SMTP/Telegram/model вызовов в этом review0, новых писем0; cloud load/VRAM/latency/полный раздел7 не подтверждены. Оценка: совместить ветки и подтвердить peer review —0.5–1 рабочего дня; live checkpoint после готовности перечисленных доступов —ещё0.5 дня, полный раздел7/нагрузка/безопасность требуют отдельного прогона и оценки по сбоям.

## Архив передачи2.2.0 — ниже не текущие задания или статус

**Новый контракт: a71d379b31c65167ef40ece6a384b7ee539bfdeb.** База: актуальный HEAD origin/feat/web-telegram-integration целиком после fetch. PRODUCT_CONTRACT_VERSION=2.2.0; npm workspace @between/contracts по-прежнему0.1.0. Не брать только старые31574f8/f3ebfc0/a619dab.
Точные сигнатуры: [facade-v2.2.md](facade-v2.2.md); обязательная семантика: [contract-v2.2.md](contract-v2.2.md) + сохранённые auth/email/inbox правила [A1 resolution](contract-a1-resolution.md).
Review исходного PR21: [review-pr21.md](review-pr21.md). Во время проверки появился PR22: **9e87107ff0c28f7202b93e8cc766e1132092732d**, feat/interfaces-a1-v21. Именно его переносить дальше; не повторять старый cherry-pick #19/#21. Подтверждение принятия2.2 Димой/Даней не получено; внешних сообщений/PR-comments/issues не отправлено.

## Фактическая совместимость

- #21: d97ddf1 (2f894e6 bot + d97ddf1 web), base f3ebfc0/DTO31574f8. Независимо32unit passed; prod build до runtime extraction падает. Полный2.2 typecheck bot/web не проходит.
- #22: свежий порт #21 на2.1, исправляет email recovery, snapshotHash calls, normalizer/recordUpdateFailure. В нём ещё Map для других сценариев, hardcoded RU и confirm новейшего, а не показанного preview. Не называть эти остатки исправленными.
- #20: опубликованная голова всё ещё f9fc3019276e081937bd3add82ade62801235717, старый /domain1.0.0; нового совместимого HTTP/facade/browser adapter на remote нет. Сверка основана на коде и CI, не авторском отчёте.
- Ни один PR не слит/закрыт. #17/#19 остаются до подтверждённого сохранения нужных сценариев с настоящим backend.

## Диме: сначала единый backend, затем полный раздел7

Если ещё работаешь только от #20: новая ветка от origin/feat/web-telegram-integration, перенести свой f9fc301 с разрешением metadata conflicts в пользу актуальных root exports/dependencies. Если есть новая незапушенная работа — сохранить её, не reset/force; совместить через merge актуальной общей базы и сообщить точный head. Не менять уже применённые001–006, только additive007+.

1. Экспорт @between/api.createDomain:CreateProductDomain, HTTP @between/api/http.createHttpAdapter:CreateHttpAdapter. /product и /http — единственные domain/user DTO. Серверные env/schema/helper только /runtime; актуальная RuntimeEnvironment, архивная LegacyRuntimeEnvironment не production.
2. Root создаёт ОДИН домен; factory/import без запуска. acquirePollerLease(actual botId), start workers/scheduler, stopAccepting/close явно. Не требовать старый options.botId при construction; не зависеть read path от модели. Один model permit/queue и pool max5 сохранить.
3. Реализовать весь A1 2.1: emailVerification/read/resend/verify result, общего DomainError, durable failed/retry_wait receipt/budget3, одноразовый web exchange+browser-bound CSRF/Origin/cookies/revoke/idle, полный preview. Не seed confirmation в production. SMTP vars/root TLS465 уже проверены отдельно; это не проверка app email workflow.
4. Persistence2.2: DialogueV2.navigation+createdAt/expiresAt; updateDialogue принимает navigation. Единственный FSM draft/nav, все owner/resource/version checks в TX. Read не продлевает; idle1h/max24h; cleanup≤60s; expire/cancel/revoke/delete очищают transient input, не saved history/runs/assessment results. Для upgrade старого preview без shown hash безопасный повторный показ, не ложная confirmation.
5. Assessment answers до submit — только navigation.assessment, без второй active draft таблицы/Map. Validate form ownership/version/choices/ordered prefix; submitAssessment требует expectedDialogueRevision, совпадающий complete draft и атомарное завершение/очистку. Конкурентные web/bot изменения →409, повтор intent не повышает счёт.
6. supportRegion/read+update с revision, по умолчанию countryCode/region null. support(ctx,{}) использует только явную настройку. Unknown/unavailable →contacts=[], не RU fallback. Каталог проверенных региональных источников и availability; account delete удаляет настройку, deleteData оставляет account preference.
7. Confirm/start/edit recheck точный показанный hash/revision/dependencies/template/budget; новая версия из другой UI не подтверждается старым click. DTO snapshotHash/start/retry2.1 уже обязателен. Некорректный/неполный output не succeeded, никаких hosted inference/repair retry.
8. recordUpdateFailure использует SAME durable intent и DB attempts≤3/nextAttemptAt; unknown terminal. Ack не превращает failed в completed. Crash after each mutation/failed persistence/ack/restart tests обязательны. Новые генерации из-за потерянного ответа запрещены.
9. Все27 функций facade-v2.2 остаются в релизе. Далее реальные domain*.test.ts + web*.test.ts на отдельной DB, zero skips, additive migration upgrade, concurrency/IDOR/CSRF и single factory lifecycle tests. Не исключать jobs/функции и не выдавать throwing stub за implementation.

## Дане: продолжать PR22, не заново PR21

Сначала сохранить собственные незакоммиченные изменения. Затем git fetch origin; git switch feat/interfaces-a1-v21; git merge --no-ff origin/feat/web-telegram-integration. Не force/reset, не перетирать manifests целиком. Рабочий PR — #22; #21 не сливать как готовый.

1. Сохранить уже сделанные2.1 email recovery/normalizer/recordUpdateFailure/hash calls. Не возвращать challenge Map: читать emailVerification из БД. Серверные schema imports — /runtime только в server code; browser /product+/http без /runtime и fixtures.
2. Удалить authoritative Memo поля editingField/speaker/cardId/reminderField/assessment.answers. Перенести их в typed navigation через updateDialogue. Web composer/card/test также сохраняют canonical domain state, не только React state; no localStorage personal text. History cursors/filter могут быть transient, данные всегда из domain.
3. При showPreview сохранить navigation.preview {id,revision,hash}. confirm/edit используют сохранённую показанную версию; свежий fetch может лишь обнаружить stale и предложить новый показ, но не заменить hash перед approve. preview_field хранит только ссылки и target field, не копию текста. Send доступен только budget.fit==='fits'.
4. Ветка: navigation.thread_turn со speaker и optional existing turnId. Выбранная cardId/contentVersion сохраняется; текст/прогресс только из catalogue. Test partial answers/идентификаторы в navigation.assessment, затем submit с expectedDialogueRevision. Любая revision collision →refetch/выбор пользователя, не silent overwrite.
5. Support: убрать RU в обоих интерфейсах, прочитать supportRegion; при необходимости спросить страну/крупный регион, явно сохранить через updateSupportRegion. Language/IP/timezone не доказательство страны. support({}) без страныпараметра, unknown — общее сообщение без случайных номеров; добавить изменение/сброс preference.
6. Retry: #22 уже улучшает claimed update budget. Проверить также claim/record-failure errors: неизвестный сбой до durable outcome не ack и не бесконечно повторять; деградация/fatal остановка с safe error вместо promise «повторю сам» навсегда. Stable key при crash после КАЖДОГО committed шага, не только при повторе того же кодового пути/seq. Не перестраивать действие с новым key.
7. Сохранить passive createTelegramTransport/один poller+outbox/finished/health/stop, private sender/inline rejection/plain text; no createDomain в transport. Все scenarios17/19 подтвердить заново после2.2, включая TTL/restart/multi-interface preview/test/card/thread recovery.
8. Проверки без stub facade/http: bot+web typecheck, real production build и неизменённый усиленный check-web-runtime; unit tests2.2 без any-casts/defaults для обхода обязательных полей. Только после B1/B2 — shared build, PG+Playwright и live.

## Интеграционный gate и доступы

Дима предоставляет apps/api/src/domain/facade.ts, apps/api/src/http/index.ts и test/browser-adapter.ts. Последний — только NODE_ENV=test, loopback3011, отдельная DB; startBrowserTestServer({origin,port,webRoot,databaseUrl})→{close}. Helper issue-web-link только test transport, обычный cookie exchange не подменять.
Порядок: contracts/root+generated docs →real facade/HTTP/bot/web build/typecheck →PostgreSQL migrations/tests0skip →Playwright test login/history/refresh/logout/2users →явно согласованные реальные Telegram/SMTP/model проверки →весь раздел7. Ни FakeProduct, ни незакоммиченный scratch API не live evidence.
SMTP ранее: отдельный TLS465 handshake, AUTH235 и ОДНО разрешённое письмо принято250. Доставка в ящик и app challenge workflow не подтверждены; в этом review новых писем не отправлялось.
Для live всё ещё нужны отдельные test bot/token и второй пользователь/чужой телефон; отдельная runtime/test DB; app auth secrets+WEB_ORIGIN; домашний GPU/weights/private endpoint+key; QQCloud persistent process/disk/Docker/SSH/DC и реальный DNS/HTTPS; private-network ACL/firewall. Не передавать секреты в чат/Git. Модельных запросов в этом review0.
