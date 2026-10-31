# A1 2.2.0 · runtime / persistent dialogue / support

Утверждённое Антоном изменение после review PR21. Дополняет A1 2.1; сигнатуры меняются явно. Источник product.ts/http.ts/runtime.ts, точный полный список27 функций и методов — facade-v2.2.md. Все функции остаются обязательными.

## Server-only runtime

RuntimeEnvironment, RuntimeEnvironmentV2 (переходный server-only alias), LegacyRuntimeEnvironment (архив), isPrivateModelUrl, RuntimeHealth/BotHealth/BOT_HEALTH_FILE теперь только @between/contracts/runtime. Root entry/health/services/model scripts переведены. Не реэкспортировать их из /product, /http, /domain или /index: это снова загрузит top-level Zod env validators в браузер.
package export runtime имеет browser:null и node/default entry. RuntimeEnvironment — актуальная схема; LegacyRuntimeEnvironment не использовать для production. ProductOptions/CreateProductDomain остаются типами интерфейса, не env-validators и не содержат реальных значений. Секреты только server env.
check-web-runtime сохранён и усилен: AST import/re-export/dynamic import graph public contracts + запрет runtime/test-fixtures из web/src + поиск server env/fixture/legacy маркеров в JS production-бандле. Guard не ослаблен ради сборки. Наличие имён env в старом бандле не доказывало утечку значений, но являлось неверной границей.

## Canonical persistent dialogue

DialogueV2 теперь содержит navigation, createdAt, expiresAt. DialoguePatch требует navigation; клиент не может задавать server timestamps/pendingRunId. Все state transitions — через updateDialogue(ctx,input,key), expectedRevision и owner checks в одной транзакции. Read не продлевает TTL. Два интерфейса читают одну запись; conflict → refetch/явный выбор, не last-write-wins.
Navigation — discriminated union:
- none;
- preview {previewId,previewRevision,snapshotHash}: ТОЧНО показанная пользователю версия;
- preview_field: те же три поля + fieldId, без копии текста;
- thread_turn {speaker:self|other,turnId:null|Id}: очередной/редактируемый turn; само содержание только в ComposerDraft.turns;
- card {cardId,contentVersion}: текст карточки/прогресс только из domain catalogue, набираемый ответ до preview может быть в draft.draft;
- assessment {assessmentId,contentVersion,assessmentKind,answers:[{questionId,choiceId}]}: единственный авторитетный незавершённый набор ответов;
- reminder_field {field:localTime|timezone|quietHours};
- support_region {field:countryCode|region}: только текущий вопрос, само предпочтение отдельно в supportRegion.

Schema проверяет совместимость step/navigation, существование turnId в собственном draft, уникальность partial question IDs. Domain дополнительно проверяет владельца/ревизию preview, editable field, существование card/form/version, допустимые choices и упорядоченный prefix ответов. Навигация никогда не источник owner, runtime context или модельной истории.
Email challenge не добавляется в FSM: единственный источник emailVerification(ctx,{}) из challenge table. Не хранить второй challengeId/email/code в Map, callback или dialogue.
После создания preview текст редактируется только в owned preview; navigation хранит ссылки/hash, не вторую копию snapshot. При показе сохранить именно показанные revision/hash. Нельзя при нажатии «Отправить» перечитать новую версию и автоматически подтвердить её. Другая UI могла изменить preview: тогда PREVIEW_STALE, новый показ и новое явное подтверждение.
submitAssessment теперь требует expectedDialogueRevision. Перед отправкой полный draft сохранён updateDialogue; домен сравнивает owner/form/version/ответы/revision и атомарно завершает попытку/очищает navigation, сохраняя итог отдельно. Конкурентный stale submit не затирает другую UI, повтор intent не начисляет баллы дважды.

## TTL и очистка

DIALOGUE_TTL_SECONDS=3600 idle после успешной мутации; DIALOGUE_MAX_LIFETIME_SECONDS=86400 от createdAt. expiresAt=min(now+1h,createdAt+24h); успешное чтение/ошибка не продлевают. Schema не принимает срок более24h от creation; точные часы/idle enforcement — сервер.
Expired read/write проверяется транзакционно: очистить transient draft/navigation/refs, увеличить revision, вернуть безопасный menu/потребовать начать заново. Maintenance в одном domain.start очищает истёкший transient content не реже раза в60s. Pending run/outbox, saved sessions, roleplay, completed assessment/progress не удаляются FSM TTL; продолжение результата — через owned history.
Явный cancel/reset, account/learning-data delete и consent withdrawal очищают transient content. Простое открытие истории/меню в другом интерфейсе не должно молча уничтожать незавершённый draft: сначала предложить продолжить/явно отменить. Menu cursor/filter допускаются как восстанавливаемая навигация без содержимого; они не заменяют доменные данные.
Только новые миграции007+ от Димы. Для старых записей без доказанной shown-preview версии нельзя выдумывать подтверждение текущего hash: безопасно сбросить transient stage с revision bump/предложением заново открыть сохранённый ресурс. Сессии, миграции001–006 и данные не переписывать. Старые значения из потерянной Map задним числом не восстанавливаются.

## Регион поддержки

Новые методы supportRegion(ctx,{})→SupportRegionSetting; updateSupportRegion(ctx,{expectedRevision,countryCode:null|две буквы,region:null|string},key)→SupportRegionSetting. HTTP GET/PATCH /api/support/region; CSRF/Origin/intent по общим правилам.
support(ctx,{}) больше НЕ принимает countryCode/region из отдельного transient параметра. Domain берёт настройку аккаунта. По умолчанию countryCode=null,region=null; только явный выбор пользователя, не язык Telegram/браузера, IP, timezone или серверный RU. Изменение/очистка видны в обеих UI. Это account preference, не дубликат dialogue.navigation; deleteData сохраняет её, deleteAccount удаляет.
Support возвращает nullable countryCode/region и availability region_required|available|unavailable. Неизвестное местоположение → region_required, contacts=[] и общее сообщение с предложением выбрать регион при необходимости. Нет проверенных локальных контактов → unavailable, contacts=[]; не подставлять RU/соседнюю страну/случайный номер. Available только для реально подходящего проверенного каталога с sourceUrl/verifiedAt. Крупный регион, без запроса точного адреса. Публикация номеров требует фактической проверки источника, схема её не заменяет.

## Retry / совместимость

Правила A1 2.1 не меняются: stable durable intentKey, не ack неопределённый исход, сверка SAME intent перед повтором, DB budget UPDATE_MAX_ATTEMPTS=3 и nextAttemptAt, неизвестная ошибка/INTERNAL_ERROR терминальны. Предел backoff60s не предел числа попыток. Использовать recordUpdateFailure и failed/retry_wait receipts; ack не превращает failed в successful completion. Нельзя повторять provider generation или выдавать новый intent из-за потерянного ответа.
PR21 d97ddf1 использует31574f8/f3ebfc0 и должен принять также все изменения2.1 (email recovery/result, hash в start/retry, DomainError, durable failure). Backend PR20 f9fc301 остаётся /domain1.0.0; полного совмещённого backend сейчас нет. Контракт опубликован для синхронного переноса, подтверждения Димы не получено. Никакие сигнатуры не считаются уже реализованными.
