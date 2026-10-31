# Интеграция · этап 2 · 01.11.2026

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
