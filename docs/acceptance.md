# Приёмка web + Telegram

Telegram-only/no-site gates заменены. Все27 строк docs/product.md обязательны сейчас; первая контрольная точка не отменяет оставшийся объём.

Первый реальный путь: private Telegram → QQCloud → подтверждённый очищенный preview → домашняя модель → результат; web login по одноразовой ссылке из того же Telegram с явным POST-подтверждением → та же история. Правки/прогресс видны с обеих сторон; два пользователя изолированы.

Обязательные gates:
- Оператор утвердил тексты policy/consent web-telegram-2 с web cookies/link/session flows; старый draft telegram-1 не подходит. Не открывать публичный сбор до этого.
- Web cookie/session/one-time-link binding, явное POST redeem, replay/race/expiry/logout/revoke/CSRF/XSS/IDOR; session raw token никогда не JSON/localStorage.
- Каждый AI step, в том числе roleplay/own draft/thread, только после exact preview confirmation. Auto email/phone masking + ручные правки всех slots, revisions/hash, token budget.
- Общая история/продолжение/pagination, ownership всех ID, stable intent/inbox/outbox, partial startup/shutdown, один poller.
- Полный раздел7: примеры/основания/comparison/direct/before-send/phrase highlight/contexts/role levels/daily/reminders/streak/skills/cards/до-после/usefulness/analytics/support/deletion.
- Опт-ин Telegram notifications, settings в обоих UI, quiet hours/DST/restart/unsubscribe. До/после не раньше реального7дневного срока, тестовые часы только явно test.
- Offline Windows: account/history/cards доступны, модельная задача получает ошибку, нет скрытых ответов/retry.
- Contracts/root, real PG integration+domain+bot, web typecheck/build и обязательные browser login/history e2e. Test adapters явные, production отвергает bypass/fixtures; отсутствие модулей — красный gate, не исключение job.
- QQCloud process/disk/Docker/HTTPS проверены фактически, не по domain-binding bot; Origin/cookies под реальный hostname, exact proxy trust без CORS wildcard.
- Измерены cloud RAM HTTP+polling+scheduler+DB/OS reserve, GPU VRAM,24 identical cases/model, cold/warm/local/cloud TTFT и total p50/p95/N/failed. Цель warm short≤5с без очереди проверяется, не обещается.
- Backup/restore отдельной DB, миграции/старые данные сохранены, rollback, reconnect/reboot/PC sleep dependency, private network allow-cloud/deny-peer.

01.11.2026: в отдельном общем candidate6755408 есть настоящие facade/auth/HTTP/web/bot. Подтверждены43 contracts/root,88 domain/HTTP/bot,13 browser checks без пропусков, production build/runtime guard и Docker import. Live ещё требует test bot/DB, SMTP workflow, частного cloud→GPU endpoint и HTTPS/QQCloud окружения; подробности и единичный невоспроизведённый test fail —в [handoff](handoff-v2.md). Ранее отдельные SMTP AUTH235/acceptance250 не доказывают app workflow. Реальный новый live N=0; метрики не измерены.

2.2.1 gates: menu/restart сохраняют частичные ответы; обычный reset или замена формы не уничтожают их; подтверждённый reset отдельным действием. Owned myRating виден через facade/HTTP/reload. Клиент не пишет run_completed, failed run не создаёт event; успешный transaction идемпотентен. Telegram редактирует и переставляет реплики по стабильным ID. Это проверяется поведением, не inventory FEATURES-27.

2.2 gates: browser production bundle without runtime schema markers; runtime import blocked under browser condition; restart/cross-interface restore of editable field/shown hash/thread speaker/card/assessment partial answers; TTL cleanup and stale conflicts; explicit support region + unknown=no contacts; durable max3 retry/unknown-terminal with actual DB and no ack on uncertain outcome.
