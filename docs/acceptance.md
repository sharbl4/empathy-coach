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

Текущие блокеры: B1/B2 фасада/auth/http и C1/C2 новые web/bot не реализованы в этой ветке; старый web Auth ещё Supabase. QQCloud/SMTP/test bot/GPU PC/tailnet доступа нет. Реальный новый live N=0, метрики не измерены. Локальные схемы/test adapters не подтверждают live.
